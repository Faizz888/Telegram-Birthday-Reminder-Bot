const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const { format, differenceInCalendarDays, addYears } = require('date-fns');
const dotenv = require('dotenv');

dotenv.config();

const token = process.env.TOKEN;
const adminGroupId = -4207698059;
const adminId = 759435004;
const bot = new Telegraf(token);



const dataFile = 'data.json';
let data = { students: {}, sessions: { active: null }, completedSessions: [] };
let lastAdminPanelMessageId = null;

const axios = require('axios');
axios.defaults.timeout = 10000; // Set timeout to 10 seconds

async function sendMessageWithRetry(chatId, text, retries = 3, delay = 1000) {
    try {
        await axios.post(`https://api.telegram.org/bot${process.env.TOKEN}/sendMessage`, {
            chat_id: chatId,
            text: text
        });
    } catch (error) {
        if (retries > 0) {
            console.log(`Retrying... Attempts left: ${retries}`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return sendMessageWithRetry(chatId, text, retries - 1, delay * 2);
        } else {
            console.error('Failed to send message after several attempts:', error.message);
        }
    }
}


function logError(message) {
    fs.appendFileSync('error_log.txt', `${new Date().toISOString()} - ${message}\n`);
}


// Load data from JSON file
function loadData() {
    try {
        data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
        if (!data.completedSessions) data.completedSessions = [];
    } catch (error) {
        saveData();
    }
}

// Save data to JSON file
function saveData() {
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
}

// Format date function to show day and month in text format
function formatDateDayMonth(date) {
    return format(new Date(date), 'MMMM do');
}

// Calculate days left until the birthday
function calculateDaysLeft(birthday) {
    const now = new Date();
    const nextBirthday = addYears(new Date(birthday), now.getFullYear() - new Date(birthday).getFullYear());
    if (nextBirthday < now) {
        return differenceInCalendarDays(addYears(nextBirthday, 1), now);
    }
    return differenceInCalendarDays(nextBirthday, now);
}

// Check if user is an admin
function isAdmin(ctx) {
    return ctx.chat.id === adminGroupId || ctx.from.id === adminId;
}

// Delete a message after a delay
async function deleteMessageAfterDelay(ctx, messageId, delay = 10000) {
    setTimeout(async () => {
        if (!messageId) return; // Ensure messageId is valid before attempting deletion
        try {
            await ctx.deleteMessage(messageId);
        } catch (error) {
            if (error.response && error.response.error_code === 400) {
                console.error(`Message ${messageId} not found or already deleted.`);
            } else {
                console.error(`Failed to delete message ${messageId}: ${error.message}`);
            }
        }
    }, delay);
}

// Example of safely deleting the previous admin panel message
async function showAdminPanel(ctx) {
    if (lastAdminPanelMessageId) {
        try {
            await ctx.deleteMessage(lastAdminPanelMessageId);
            lastAdminPanelMessageId = null; // Clear the ID after deletion
        } catch (error) {
            console.error(`Failed to delete previous admin panel (ID: ${lastAdminPanelMessageId}): ${error.message}`);
        }
    }

    let keyboard = [
        [Markup.button.callback('Запустить процесс дня рождения', 'initiate_birthday')],
        [Markup.button.callback('Показать статусы', 'show_status')],
        [Markup.button.callback('Поблагодарить пользователя', 'thank_user')],
        [Markup.button.callback('Напомнить о скидывании', 'notify_chipping')],
    ];

    if (data.sessions.active) {
        keyboard.unshift([Markup.button.callback(`Активная сессия: ${data.sessions.active.name}`, 'show_status')]);
        keyboard.push([Markup.button.callback('Завершить сессию', 'confirm_end_session')]);
    }

    const sentMessage = await ctx.reply('Панель администраторов:', Markup.inlineKeyboard(keyboard));
    lastAdminPanelMessageId = sentMessage.message_id;
}

// Safely handle thank user confirmation
bot.action(/^thank_(\d+)$/, async (ctx) => {
    const userId = ctx.match[1];
    const student = data.students[userId];

    if (student) {
        try {
            await ctx.deleteMessage(); // Safely delete the message that triggered this action
        } catch (error) {
            console.error(`Failed to delete the triggering message: ${error.message}`);
        }

        const sentMessage = await ctx.reply(`Вы точно хотите поблагодарить ${student.name}?`, Markup.inlineKeyboard([
            [Markup.button.callback('Да', `confirm_thank_${userId}`)],
            [Markup.button.callback('Нет', `cancel_thank_${userId}`)]
        ]));

        // Store the message ID for later deletion
        data.sessions.confirmMessageId = sentMessage.message_id;
        saveData();
    } else {
        const sentMessage = await ctx.reply('Неправильный выбор.');
        deleteMessageAfterDelay(ctx, sentMessage.message_id);
    }
});

// Confirm Thank User
bot.action(/^confirm_thank_(\d+)$/, async (ctx) => {
    const userId = ctx.match[1];
    const student = data.students[userId];

    if (student) {
        data.sessions.active.chippedIn.push(userId);
        saveData();

        // Safely delete the confirmation message and Yes/No inline keyboard
        if (data.sessions.confirmMessageId) {
            try {
                await ctx.deleteMessage(data.sessions.confirmMessageId);
            } catch (error) {
                console.error(`Failed to delete the confirmation message: ${error.message}`);
            }
            data.sessions.confirmMessageId = null;
        }

        try {
            await ctx.deleteMessage(); // Delete the Yes/No inline keyboard
        } catch (error) {
            console.error(`Failed to delete the Yes/No inline keyboard: ${error.message}`);
        }

        await safeSendMessage(userId, `💐 Спасибо, что скинулись на день рождения ${data.sessions.active.name}!`);
        const sentMessage = await ctx.reply(`Сообщение благодарности отправлено ${student.name}.`);
        deleteMessageAfterDelay(ctx, sentMessage.message_id);
    } else {
        const sentMessage = await ctx.reply('Неправильный выбор.');
        deleteMessageAfterDelay(ctx, sentMessage.message_id);
    }
});


// Show Admin Panel
async function showAdminPanel(ctx) {
    if (lastAdminPanelMessageId) {
        try {
            await ctx.deleteMessage(lastAdminPanelMessageId);
        } catch (error) {
            console.error(`Failed to delete previous admin panel: ${error.message}`);
        }
    }

    let keyboard = [
        [Markup.button.callback('Запустить процесс дня рождения', 'initiate_birthday')],
        [Markup.button.callback('Показать статусы', 'show_status')],
        [Markup.button.callback('Поблагодарить пользователя', 'thank_user')],
        [Markup.button.callback('Напомнить о скидывании', 'notify_chipping')],
    ];

    if (data.sessions.active) {
        keyboard.unshift([Markup.button.callback(`Активная сессия: ${data.sessions.active.name}`, 'show_status')]);
        keyboard.push([Markup.button.callback('Завершить сессию', 'confirm_end_session')]);
    }

    const sentMessage = await ctx.reply('Панель администраторов:', Markup.inlineKeyboard(keyboard));
    lastAdminPanelMessageId = sentMessage.message_id;
}

function isValidDateFormat(dateString) {
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    return regex.test(dateString);
}

function isValidDate(dateString) {
    if (!isValidDateFormat(dateString)) {
        return false;
    }

    const [year, month, day] = dateString.split('-').map(Number);
    const date = new Date(year, month - 1, day);

    // Check if the date object matches the input date
    return date.getFullYear() === year &&
           date.getMonth() === (month - 1) &&
           date.getDate() === day;
}


// Bot start command for user registration
bot.start(async (ctx) => {
    if (ctx.chat.type === 'private') {
        await ctx.reply('Добро пожаловать! Введите свое имя ✨');
    }
});

// Admin Panel Command
bot.command('admin_panel', async (ctx) => {
    if (isAdmin(ctx)) {
        await showAdminPanel(ctx);
    } else {
        const sentMessage = await ctx.reply('❌ У вас нет прав на использование этой команды.');
        deleteMessageAfterDelay(ctx, sentMessage.message_id);
    }
});

// Handle text messages for user registration and admin commands
bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const userText = ctx.message.text;

    if (ctx.chat.type === 'private') {
        if (!data.students[userId]) {
            data.students[userId] = { name: userText, chippedIn: false };
            await sendMessageWithRetry(userId,  `😎 Рад знакомству, ${userText}!\n\nВведи свой день рождения в формате ГГГГ-ММ-ДД\n\nНапример: 2004-07-01`);
        } else if (!data.students[userId].birthday) {
            if (isValidDate(userText)) {
                data.students[userId].birthday = userText;
                saveData();
                await sendMessageWithRetry(userId, 'Успешно зарегистированы!');
                await sendMessageWithRetry(userId, '🎈 Я буду уведомлять других о твоем дне рождении, а также тебя о дне рождении других 😁');
            } else {
                await sendMessageWithRetry(userId, '❌ Неправильный формат или недействительная дата. Введите день рождения в формате ГГГГ-ММ-ДД');
            }
        }
    } else if (isAdmin(ctx)) {
        // Handle admin commands in the group
        if (data.sessions.active && !data.sessions.active.giftDetails) {
            data.sessions.active.giftDetails = userText;
            await ctx.deleteMessage(); // Safely delete message
            await ctx.reply('Введите сумму скидывания');
        } else if (data.sessions.active && !data.sessions.active.contributionAmount) {
            data.sessions.active.contributionAmount = userText;
            const daysLeft = calculateDaysLeft(data.sessions.active.birthday);
            const message = `🎆 День рождения ${data.sessions.active.name} будет ${formatDateDayMonth(data.sessions.active.birthday)} (осталось ${daysLeft} дней).\n\nДавайте скинемся по ${data.sessions.active.contributionAmount} на номер ${process.env.phonenumber} Kaspi/Halyk\n\n 🎁 Подарок: ${data.sessions.active.giftDetails}`;
            saveData();

            // Show message preview in admin group with options to modify or send
            await ctx.deleteMessage(); // Safely delete message
            await ctx.reply(`Предварительный просмотр:\n\n${message}`, Markup.inlineKeyboard([
               // [Markup.button.callback('Modify', 'modify_message')],
                [Markup.button.callback('Отправить', 'send_final_message')]
            ]));
        }
    }
});

// Initiate Birthday Process
bot.action('initiate_birthday', async (ctx) => {
    if (data.sessions.active) {
        const sentMessage = await ctx.reply(`❌ Сессия на день рождения ${data.sessions.active.name} в процессе. Сначала завершите данную сессию.`);
        deleteMessageAfterDelay(ctx, sentMessage.message_id);
    } else {
        const studentsKeyboard = Object.keys(data.students).map(userId => {
            const student = data.students[userId];
            return [Markup.button.callback(student.name, `set_birthday_person_${userId}`)];
        });

        await ctx.reply('Выберите именинника:', Markup.inlineKeyboard(studentsKeyboard));
    }
});

// Set Birthday Person
bot.action(/^set_birthday_person_(\d+)$/, async (ctx) => {
    const userId = ctx.match[1];
    const student = data.students[userId];

    if (student) {
        data.sessions.active = {
            birthdayPersonId: userId,
            name: student.name,
            birthday: student.birthday,
            chippedIn: [],
            giftDetails: null,
            contributionAmount: null
        };
        await ctx.reply(`🎁 Вы выбрали ${student.name}. Укажите, какой будет подарок.`);
    } else {
        const sentMessage = await ctx.reply('Invalid selection.');
        deleteMessageAfterDelay(ctx, sentMessage.message_id);
    }
});

// Handle modifying the message
bot.action('modify_message', async (ctx) => {
    if (data.sessions.active) {
        await ctx.reply('Please modify the message details.');
    }
});

// Send final message
bot.action('send_final_message', async (ctx) => {
    if (data.sessions.active) {
        const daysLeft = calculateDaysLeft(data.sessions.active.birthday);
        const message = `🎆 День рождения ${data.sessions.active.name} будет ${formatDateDayMonth(data.sessions.active.birthday)} (осталось ${daysLeft} дней).\n\nДавайте скинемся по ${data.sessions.active.contributionAmount} на номер ${process.env.phonenumber} Kaspi/Halyk\n\n 🎁 Подарок: ${data.sessions.active.giftDetails}`;

        Object.keys(data.students).forEach(id => {
            if (id !== data.sessions.active.birthdayPersonId) {
                safeSendMessage(id, message);
            }
        });

        await ctx.reply('✅ Сообщение отправлено всем студентам (кроме именинника 😁).');
        showAdminPanel(ctx);
    }
});

// Confirmation for Ending Session
bot.action('confirm_end_session', async (ctx) => {
    if (data.sessions.active) {
        const sentMessage = await ctx.reply(`Вы точно хотите завершить сессию ${data.sessions.active.name}?`, Markup.inlineKeyboard([
            [Markup.button.callback('Да', 'end_current_session')],
            [Markup.button.callback('Нет', 'back_to_active_session')]
        ]));
        deleteMessageAfterDelay(ctx, sentMessage.message_id);
    }
});

// Handle "No, Cancel" to return to the active session menu
bot.action('back_to_active_session', async (ctx) => {
    if (data.sessions.active) {
        await ctx.deleteMessage(); // Safely delete message
        showAdminPanel(ctx);
    }
});

// Handle the cancellation of an action
bot.action('cancel', async (ctx) => {
    const sentMessage = await ctx.reply('✓ Действие отменено.');
    deleteMessageAfterDelay(ctx, sentMessage.message_id);
    showAdminPanel(ctx);
});

// Show Status
bot.action('show_status', async (ctx) => {
    if (isAdmin(ctx)) {
        if (data.sessions.active) {
            const statusKeyboard = Object.keys(data.students).map(userId => {
                if (userId !== data.sessions.active.birthdayPersonId) {
                    const student = data.students[userId];
                    const status = data.sessions.active.chippedIn.includes(userId) ? '✅ Скинулись' : '❌ Не скинулись';
                    return [Markup.button.callback(`${student.name} — ${status}`, `status_${userId}`)];
                }
            }).filter(Boolean);

            statusKeyboard.push([Markup.button.callback('Напомнить о скидывании', 'notify_chipping')]);
            statusKeyboard.push([Markup.button.callback('⏪ Назад', 'back_to_active_session')]);

            await ctx.deleteMessage(); // Safely delete the previous menu message
            await ctx.reply(`Статус дня рождения ${data.sessions.active.name}:`, Markup.inlineKeyboard(statusKeyboard));
        } else {
            const sentMessage = await ctx.reply('❌ Не выбран именинник.');
            deleteMessageAfterDelay(ctx, sentMessage.message_id);
        }
    } else {
        const sentMessage = await ctx.reply('❌ У вас нет прав на использование этой команды.');
        deleteMessageAfterDelay(ctx, sentMessage.message_id);
    }
});

// Thank User
bot.action('thank_user', async (ctx) => {
    if (isAdmin(ctx)) {
        if (data.sessions.active) {
            const studentsKeyboard = Object.keys(data.students).map(userId => {
                if (userId !== data.sessions.active.birthdayPersonId && !data.sessions.active.chippedIn.includes(userId)) {
                    const student = data.students[userId];
                    return [Markup.button.callback(student.name, `thank_${userId}`)];
                }
            }).filter(Boolean);

            studentsKeyboard.push([Markup.button.callback('⏪ Назад', 'back_to_menu')]);

            await ctx.deleteMessage(); // Safely delete message
            await ctx.reply('Выберите, кого поблагодарить:', Markup.inlineKeyboard(studentsKeyboard));
        } else {
            const sentMessage = await ctx.reply('❌ Не выбран именинник.');
            deleteMessageAfterDelay(ctx, sentMessage.message_id);
        }
    } else {
        const sentMessage = await ctx.reply('❌ У вас нет прав на использование этой команды.');
        deleteMessageAfterDelay(ctx, sentMessage.message_id);
    }
});

// Thank a specific user
bot.action(/^thank_(\d+)$/, async (ctx) => {
    const userId = ctx.match[1];
    const student = data.students[userId];

    if (student) {
        try {
            await ctx.deleteMessage(); // Delete the message that triggered this action
        } catch (error) {
            console.error(`Failed to delete the triggering message: ${error.message}`);
        }

        const sentMessage = await ctx.reply(`Вы точно хотите поблагодарить ${student.name}?`, Markup.inlineKeyboard([
            [Markup.button.callback('Да', `confirm_thank_${userId}`)],
            [Markup.button.callback('Нет', `cancel_thank_${userId}`)]
        ]));

        // Store the message ID for later deletion
        data.sessions.confirmMessageId = sentMessage.message_id;
        saveData();
    } else {
        const sentMessage = await ctx.reply('❌ Неправильный выбор.');
        deleteMessageAfterDelay(ctx, sentMessage.message_id);
    }
});

// Confirm Thank User
bot.action(/^confirm_thank_(\d+)$/, async (ctx) => {
    const userId = ctx.match[1];
    const student = data.students[userId];

    if (student) {
        data.sessions.active.chippedIn.push(userId);
        saveData();

        // Safely delete the confirmation message
        try {
            if (data.sessions.confirmMessageId) {
                await ctx.deleteMessage(data.sessions.confirmMessageId); // Delete the confirmation message
                data.sessions.confirmMessageId = null; // Clear the message ID after deletion
            }
        } catch (error) {
            console.error(`Failed to delete the confirmation message: ${error.message}`);
        }

        try {
            await ctx.deleteMessage(); // Delete the Yes/No inline keyboard
        } catch (error) {
            console.error(`Failed to delete the Yes/No inline keyboard: ${error.message}`);
        }

        await safeSendMessage(userId, `💐 Спасибо, что скинулись на день рождения ${data.sessions.active.name}!`);
        const sentMessage = await ctx.reply(`✅ Сообщение благодарности отправлено ${student.name}.`);
        deleteMessageAfterDelay(ctx, sentMessage.message_id);
    } else {
        const sentMessage = await ctx.reply('❌ Неправильный выбор.');
        deleteMessageAfterDelay(ctx, sentMessage.message_id);
    }
});

// Cancel Thank User
bot.action(/^cancel_thank_(\d+)$/, async (ctx) => {
    // Safely delete the confirmation message
    try {
        if (data.sessions.confirmMessageId) {
            await ctx.deleteMessage(data.sessions.confirmMessageId); // Delete the confirmation message
            data.sessions.confirmMessageId = null; // Clear the message ID after deletion
        }
    } catch (error) {
        console.error(`Failed to delete the confirmation message: ${error.message}`);
    }

    try {
        await ctx.deleteMessage(); // Delete the Yes/No inline keyboard
    } catch (error) {
        console.error(`Failed to delete the Yes/No inline keyboard: ${error.message}`);
    }

    const sentMessage = await ctx.reply('✓ Действие отменено.');
    deleteMessageAfterDelay(ctx, sentMessage.message_id);
});

// Notify About Chipping
bot.action('notify_chipping', async (ctx) => {
    if (isAdmin(ctx)) {
        if (data.sessions.active) {
            const allChippedIn = Object.keys(data.students).every(id => 
                data.sessions.active.chippedIn.includes(id) || id === data.sessions.active.birthdayPersonId
            );

            if (allChippedIn) {
                const sentMessage = await ctx.reply('Все скинулись :)');
                deleteMessageAfterDelay(ctx, sentMessage.message_id);
            } else {
                const daysLeft = calculateDaysLeft(data.sessions.active.birthday);
                const message = `🎆 День рождения ${data.sessions.active.name} будет ${formatDateDayMonth(data.sessions.active.birthday)} (осталось ${daysLeft} дней). Давайте скинемся по ${data.sessions.active.contributionAmount}`;

                await ctx.reply(`Предварительный просмотр напоминания:\n\n${message}`, Markup.inlineKeyboard([
                    [Markup.button.callback('Отправить', 'send_reminder')]
                ]));
            }
        } else {
            const sentMessage = await ctx.reply('❌ Не выбран именинник.');
            deleteMessageAfterDelay(ctx, sentMessage.message_id);
        }
    } else {
        const sentMessage = await ctx.reply('❌ У вас нет прав на использование этой команды.');
        deleteMessageAfterDelay(ctx, sentMessage.message_id);
    }
});

// Send Reminder to Students
bot.action('send_reminder', async (ctx) => {
    if (data.sessions.active) {
        const daysLeft = calculateDaysLeft(data.sessions.active.birthday);
        const message = `День рождения ${data.sessions.active.name} будет ${formatDateDayMonth(data.sessions.active.birthday)} (осталось ${daysLeft} дней). Пожалуйста, отправьте ${data.sessions.active.contributionAmount}.`;

        Object.keys(data.students).forEach(id => {
            if (id !== data.sessions.active.birthdayPersonId && !data.sessions.active.chippedIn.includes(id)) {
                safeSendMessage(id, `⏰ Напоминание: ${message}`);
            }
        });
        await ctx.deleteMessage(); // Safely delete message
        const sentMessage = await ctx.reply('✅ Напоминание отправлено тем кто не скинулся');
        //deleteMessageAfterDelay(ctx, sentMessage.message_id);
    }
});

// End Current Session
bot.action('end_current_session', async (ctx) => {
    if (isAdmin(ctx)) {
        await ctx.reply(`Завершение сессии ${data.sessions.active.name}...`);

        data.completedSessions.push({
            name: data.sessions.active.name,
            birthday: data.sessions.active.birthday,
            chippedIn: data.sessions.active.chippedIn,
            didNotChipIn: Object.keys(data.students).filter(id => 
                !data.sessions.active.chippedIn.includes(id) && id !== data.sessions.active.birthdayPersonId
            )
        });

        data.sessions.active = null;
        saveData();

        await ctx.deleteMessage(); // Safely delete message
        showAdminPanel(ctx);
    } else {
        const sentMessage = await ctx.reply('❌ У вас нет прав на использование этой команды.');
        deleteMessageAfterDelay(ctx, sentMessage.message_id);
    }
});

// Safe sendMessage with error handling
async function safeSendMessage(chatId, message) {
    try {
        await bot.telegram.sendMessage(chatId, message);
    } catch (error) {
        console.error(`Failed to send message to ${chatId}: ${error.message}`);
    }
}

loadData();
bot.launch().then(() => {
    console.log('Bot is running...');
})
