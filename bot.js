const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const axios = require('axios');
const he = require('he');
const { URL } = require('url');

console.log("Bot Script Initializing...");
const botStartTime = new Date();

const BOT_TOKEN = '7566526510:AAEFbGsv4h9cgRCGNgehnAr6bYU3OJ2dbAM';
const ADMIN_ID = '5197344486';

const USER_DATA_FILE = 'user.json';
const USER_STATES_FILE = 'user_states.json';

const BROADCAST_DELAY_MS = 300;
const KEEP_ALIVE_INTERVAL = 5 * 60 * 1000;

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

function getBotUptime() {
    const now = new Date();
    const uptimeMillis = now.getTime() - botStartTime.getTime();
    const seconds = Math.floor((uptimeMillis / 1000) % 60);
    const minutes = Math.floor((uptimeMillis / (1000 * 60)) % 60);
    const hours = Math.floor((uptimeMillis / (1000 * 60 * 60)) % 24);
    const days = Math.floor(uptimeMillis / (1000 * 60 * 60 * 24));
    let uptimeString = '';
    if (days > 0) uptimeString += `${days}d `;
    if (hours > 0 || days > 0) uptimeString += `${hours}h `;
    if (minutes > 0 || hours > 0 || days > 0) uptimeString += `${minutes}m `;
    uptimeString += `${seconds}s`;
    return uptimeString.trim() || '0s';
}

function getUserDataSync() {
    try {
        if (fs.existsSync(USER_DATA_FILE)) return JSON.parse(fs.readFileSync(USER_DATA_FILE, 'utf8'));
    } catch (error) { console.error(`Error reading user data:`, error); }
    return {};
}

function saveUserDataSync(chatId, originalUrl, shortUrlForSaving) {
    const userData = getUserDataSync();
    const userKey = String(chatId);
    if (!userData[userKey]) userData[userKey] = { url_count: 0, urls: [] };
    userData[userKey].url_count += 1;
    userData[userKey].urls.push({ original: originalUrl, shortened: shortUrlForSaving });
    try { fs.writeFileSync(USER_DATA_FILE, JSON.stringify(userData, null, 2)); }
    catch (error) { console.error(`Error saving user data:`, error); }
}

function getChatStateSync(chatId) {
    const key = String(chatId);
    try {
        if (fs.existsSync(USER_STATES_FILE)) {
            const states = JSON.parse(fs.readFileSync(USER_STATES_FILE, 'utf8'));
            return states[key] || null;
        }
    } catch (error) { console.error(`Error reading chat state for ${key}:`, error); }
    return null;
}

function getAllChatStatesSync() {
    try {
        if (fs.existsSync(USER_STATES_FILE)) return JSON.parse(fs.readFileSync(USER_STATES_FILE, 'utf8'));
    } catch (error) { console.error(`Error reading all chat states:`, error); }
    return {};
}

function saveChatStateSync(chatId, state, data = {}) {
    const key = String(chatId);
    let states = getAllChatStatesSync();
    states[key] = { state, data };
    try { fs.writeFileSync(USER_STATES_FILE, JSON.stringify(states, null, 2)); }
    catch (error) { console.error(`Error saving chat state for ${key}:`, error); }
}

function clearChatStateSync(chatId) {
    const key = String(chatId);
    let states = getAllChatStatesSync();
    delete states[key];
    try { fs.writeFileSync(USER_STATES_FILE, JSON.stringify(states, null, 2)); }
    catch (error) { console.error(`Error clearing chat state for ${key}:`, error); }
}

function isValidUrl(string) {
    try { new URL(string); return true; } catch (_) { return false; }
}

function getYouTubeVideoId(videoUrl) {
    if (!videoUrl || typeof videoUrl !== 'string') return null;
    try {
        const url = new URL(videoUrl); let videoId = null;
        if ((url.hostname === 'youtu.be' || url.hostname === 'https://youtu.be/VIDEO_ID?si=SHARE_ID')) videoId = url.pathname.substring(1).split('/')[0];
        else if (url.hostname.includes('youtube.com') || url.hostname.includes('music.youtube.com')) {
            if (url.pathname === '/watch') videoId = url.searchParams.get('v');
            else if (url.pathname.startsWith('/embed/')) videoId = url.pathname.substring('/embed/'.length).split('/')[0];
            else if (url.pathname.startsWith('/v/')) videoId = url.pathname.substring('/v/'.length).split('/')[0];
            else if (url.pathname.length > 1 && url.pathname.startsWith('/')) {
                const pathParts = url.pathname.substring(1).split('/');
                if (pathParts[0] && pathParts[0].length === 11) videoId = pathParts[0];
                else if (pathParts[0] === 'shorts' && pathParts[1] && pathParts[1].length === 11) videoId = pathParts[1];
            }
        }
        if (videoId && videoId.length === 11 && /^[a-zA-Z0-9_-]{11}$/.test(videoId)) return videoId;
        const match = videoUrl.match(/(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/|yt\.be\/)([a-zA-Z0-9_-]{11})/);
        if (match && match[1]) return match[1]; return null;
    } catch (e) {
        const match = videoUrl.match(/(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/|yt\.be\/)([a-zA-Z0-9_-]{11})/);
        if (match && match[1]) return match[1]; return null;
    }
}

async function getYouTubeVideoDetails(videoUrl) {
    console.log(`[getYouTubeVideoDetails] Starting to fetch details for: ${videoUrl}`);
    try {
        const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
        const response = await axios.get(videoUrl, { timeout: 10000, headers: { 'User-Agent': userAgent } });
        const htmlContent = response.data;
        
        const titleMatch = htmlContent.match(/<title[^>]*>(.*?)<\/title>/is);
        
        if (!titleMatch || !titleMatch[1]) {
            console.error('[getYouTubeVideoDetails] ERROR: Could not find <title> tag in the HTML response.');
            return null;
        }

        let pageTitle = titleMatch[1];
        console.log(`[getYouTubeVideoDetails] Found raw page title: "${pageTitle}"`);

        const cleanTitle = he.decode(pageTitle).replace(/\s*-\s*YouTube$/i, '').trim();
        console.log(`[getYouTubeVideoDetails] Cleaned title: "${cleanTitle}"`);
        
        const videoId = getYouTubeVideoId(videoUrl);
        if (!videoId) {
            console.error('[getYouTubeVideoDetails] ERROR: Could not extract YouTube Video ID.');
            return null;
        }

        return { title: cleanTitle, thumbnail: `http://img.youtube.com/vi/$${videoId}/maxresdefault.jpg` };

    } catch (error) {
        console.error(`[getYouTubeVideoDetails] CRITICAL ERROR fetching or processing URL:`, error.message);
        return null;
    }
}

async function shortenUrl(longUrl, title, thumbnail, chatId) {
    const apiEndpoint = "https://short-api-three.vercel.app/save";
    const serviceBotToken = '7978765687:AAH4M_fRpBi8nB6xKvUXCzn00hwxdl4dJoQ';
    const data = {
        chatId: String(chatId),
        botToken: serviceBotToken,
        longUrl: longUrl,
        customTitle: title,
        previewImage: thumbnail
    };
    try {
        const response = await axios.post(apiEndpoint, data, { headers: { 'Content-Type': 'application/json' }, timeout: 15000 });
        const responseData = response.data;
        const shortCode = responseData.shortCode;
        if (shortCode) {
            const linkForSavingInDb = `https://short-api-three.vercel.app/data/${shortCode}`;
            const displayV1 = `https://movies-links-bd.vercel.app?code=${shortCode}`;
            const displayV2 = `https://movie-links-in.vercel.app/?code=${shortCode}`;
            const displayV3 = `https://api.reshu.whf.bz/short/v2/?code=${shortCode}`;
            return {
                linkForSaving: linkForSavingInDb,
                v1: displayV1,
                v2: displayV2,
                v3: displayV3
            };
        } else {
            console.error(`Vercel API Error (shortenUrl):`, responseData.error || 'Unknown error');
            return null;
        }
    } catch (error) {
        console.error(`Network/Request Error (shortenUrl to Vercel):`, error.message);
        return null;
    }
}

async function sendChunkedMessage(botInstance, chatId, message, parseMode = undefined) {
    const maxLength = 4096;
    if (message.length <= maxLength) {
        try { await botInstance.sendMessage(chatId, message, { parse_mode: parseMode }); }
        catch (error) {
            console.error(`Error sending single message (length ${message.length}): ${error.message}`);
        } return;
    }
    const chunks = []; let currentPosition = 0;
    while (currentPosition < message.length) {
        let chunkEnd = currentPosition + maxLength; let isLastChunkOfString = false;
        if (chunkEnd >= message.length) { chunkEnd = message.length; isLastChunkOfString = true; }
        else { let newlineIndex = message.substring(currentPosition, chunkEnd).lastIndexOf('\n'); if (newlineIndex > 0) chunkEnd = currentPosition + newlineIndex + 1;}
        if (chunkEnd <= currentPosition && currentPosition < message.length) chunkEnd = currentPosition + 1;
        if (chunkEnd <= currentPosition) break; chunks.push(message.substring(currentPosition, chunkEnd)); currentPosition = chunkEnd;
    }
    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]; if (chunk.length === 0) continue;
        try { await botInstance.sendMessage(chatId, chunk, { parse_mode: parseMode }); }
        catch (error) {
            console.error(`Error sending chunk ${i + 1}/${chunks.length} (length ${chunk.length}): ${error.message}`);
        }
    }
}

function keepAlive() {
    bot.getMe().then((botInfo) => {
        console.log(`Keep-alive ping: Bot ${botInfo.username} is alive. ${new Date().toLocaleTimeString()}`);
    }).catch((error) => {
        console.error(`Keep-alive ping failed: ${error.message}`);
    });
}

async function broadcastMessageToUsers(adminChatId, broadcastData) {
    const allUsers = getUserDataSync();
    const userIds = Object.keys(allUsers);
    let successCount = 0; let failureCount = 0;
    if (userIds.length === 0) { await bot.sendMessage(adminChatId, "No users found to broadcast to."); return; }
    await bot.sendMessage(adminChatId, `🚀 Starting broadcast to ${userIds.length} users...`);
    for (const userId of userIds) {
        try {
            switch (broadcastData.type) {
                case 'text': await bot.sendMessage(userId, broadcastData.content); break;
                case 'photo': await bot.sendPhoto(userId, broadcastData.file_id, { caption: broadcastData.caption }); break;
                case 'video': await bot.sendVideo(userId, broadcastData.file_id, { caption: broadcastData.caption }); break;
                case 'advanced_text': await bot.sendMessage(userId, broadcastData.content, { reply_markup: { inline_keyboard: broadcastData.buttons } }); break;
            }
            successCount++;
        } catch (error) {
            failureCount++;
            console.error(`Failed to send broadcast to user ${userId}: ${error.message}`);
        }
        await new Promise(resolve => setTimeout(resolve, BROADCAST_DELAY_MS));
    }
    await bot.sendMessage(adminChatId, `📢 Broadcast finished.\n✅ Sent to: ${successCount} users.\n❌ Failed for: ${failureCount} users.`);
}

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    clearChatStateSync(chatId);
    const keyboardLayout = [
        [{ text: '🎥 YouTube URL Shortener' }, { text: '🌐 Regular URL Shortener' }]
    ];
    if (String(chatId) === ADMIN_ID) {
        keyboardLayout.push([{ text: '📊 View Users' }, { text: '📈 Bot Stats' }]);
        keyboardLayout.push([{ text: '📢 Broadcast Message' }]);
    }
    const replyMarkup = { keyboard: keyboardLayout, resize_keyboard: true, one_time_keyboard: false };
    bot.sendMessage(chatId, "👋 Welcome! Please choose an option:", { reply_markup: replyMarkup });
    console.log(`/start processed for chat ID: ${chatId}`);
});

bot.onText(/\/ping/, async (msg) => {
    const chatId = msg.chat.id;
    const startTime = Date.now();
    const sentMessage = await bot.sendMessage(chatId, "Pinging...");
    const endTime = Date.now();
    const latency = endTime - startTime;
    bot.editMessageText(`Pong! 🏓\nLatency: ${latency} ms`, { chat_id: chatId, message_id: sentMessage.message_id });
    console.log(`Ping command by ${chatId}: ${latency} ms`);
});

bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const data = callbackQuery.data;
    const adminChatId = String(msg.chat.id);

    if (adminChatId !== ADMIN_ID) {
        await bot.answerCallbackQuery(callbackQuery.id, { text: "Access Denied." });
        return;
    }
    await bot.answerCallbackQuery(callbackQuery.id);

    try {
      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: adminChatId, message_id: msg.message_id });
    } catch(e) { }


    if (data === 'bc_type_text') {
        saveChatStateSync(adminChatId, 'admin_broadcast_awaiting_text');
        await bot.sendMessage(adminChatId, "📝 Send me the text message for broadcast.");
    } else if (data === 'bc_type_photo') {
        saveChatStateSync(adminChatId, 'admin_broadcast_awaiting_photo');
        await bot.sendMessage(adminChatId, "🖼️ Send me the photo for broadcast.");
    } else if (data === 'bc_type_video') {
        saveChatStateSync(adminChatId, 'admin_broadcast_awaiting_video');
        await bot.sendMessage(adminChatId, "📹 Send me the video for broadcast.");
    } else if (data === 'bc_type_advanced_text') {
        saveChatStateSync(adminChatId, 'admin_broadcast_awaiting_advanced_text');
        await bot.sendMessage(adminChatId, "✨ Send me the text for the broadcast. Then, you'll provide inline buttons.");
    } else if (data === 'bc_cancel_broadcast_setup') {
        clearChatStateSync(adminChatId);
        await bot.sendMessage(adminChatId, "Broadcast setup cancelled.");
    }
    else if (data.startsWith('bc_confirm_send_')) {
        const adminState = getChatStateSync(adminChatId);
        if (!adminState || !adminState.data) {
            await bot.sendMessage(adminChatId, "Error: Broadcast data not found. Please start over.");
            clearChatStateSync(adminChatId);
            return;
        }
        
        let broadcastPayload = {};
        const action = data.substring('bc_confirm_send_'.length);

        if (action === 'text') {
            broadcastPayload = { type: 'text', content: adminState.data.text };
        } else if (action === 'photo') {
            broadcastPayload = { type: 'photo', file_id: adminState.data.photo_file_id, caption: adminState.data.caption };
        } else if (action === 'video') {
            broadcastPayload = { type: 'video', file_id: adminState.data.video_file_id, caption: adminState.data.caption };
        } else if (action === 'advanced') {
            broadcastPayload = { type: 'advanced_text', content: adminState.data.text, buttons: adminState.data.buttons };
        } else {
            await bot.sendMessage(adminChatId, "Unknown broadcast confirmation. Please start over.");
            clearChatStateSync(adminChatId);
            return;
        }
        
        await bot.sendMessage(adminChatId, `Broadcasting ${action}... please wait.`);
        await broadcastMessageToUsers(adminChatId, broadcastPayload);
        clearChatStateSync(adminChatId);
    }
});


bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text && !msg.photo && !msg.video) return;
    if (text === '/start' || text === '/ping') return;

    const isAdmin = String(chatId) === ADMIN_ID;
    const currentChatState = getChatStateSync(chatId);

    if (isAdmin && currentChatState && currentChatState.state.startsWith('admin_broadcast_')) {
        const adminState = currentChatState.state;
        const adminData = currentChatState.data || {};
        const botUsername = (await bot.getMe()).username;

        if (adminState === 'admin_broadcast_awaiting_text') {
            saveChatStateSync(ADMIN_ID, 'admin_broadcast_confirm_text', { text: text });
            await bot.sendMessage(ADMIN_ID, `Text for broadcast:\n\n${text}\n\nConfirm send?`, {
                reply_markup: { inline_keyboard: [[{text: "✅ Send Text", callback_data: "bc_confirm_send_text"}, {text: "❌ Cancel", callback_data: "bc_cancel_broadcast_setup"}]] }
            });
        } else if (adminState === 'admin_broadcast_awaiting_photo_caption') {
            const caption = (text === '/skip' || text === `/skip@${botUsername}`) ? null : text;
            saveChatStateSync(ADMIN_ID, 'admin_broadcast_confirm_photo', { ...adminData, caption: caption });
            const captionPreview = caption ? `\nCaption:\n${caption}` : "\n(No caption)";
            await bot.sendPhoto(ADMIN_ID, adminData.photo_file_id, { caption: `Photo to broadcast.${captionPreview}\n\nConfirm send?`,
                reply_markup: { inline_keyboard: [[{text: "✅ Send Photo", callback_data: "bc_confirm_send_photo"}, {text: "❌ Cancel", callback_data: "bc_cancel_broadcast_setup"}]] }
            });
        } else if (adminState === 'admin_broadcast_awaiting_video_caption') {
            const caption = (text === '/skip' || text === `/skip@${botUsername}`) ? null : text;
            saveChatStateSync(ADMIN_ID, 'admin_broadcast_confirm_video', { ...adminData, caption: caption });
            const captionPreview = caption ? `\nCaption:\n${caption}` : "\n(No caption)";
            await bot.sendVideo(ADMIN_ID, adminData.video_file_id, { caption: `Video to broadcast.${captionPreview}\n\nConfirm send?`,
                reply_markup: { inline_keyboard: [[{text: "✅ Send Video", callback_data: "bc_confirm_send_video"}, {text: "❌ Cancel", callback_data: "bc_cancel_broadcast_setup"}]] }
            });
        } else if (adminState === 'admin_broadcast_awaiting_advanced_text') {
            saveChatStateSync(ADMIN_ID, 'admin_broadcast_awaiting_buttons_json', { text: text });
            await bot.sendMessage(ADMIN_ID, "Text saved. Now send the JSON for inline buttons. Example:\n[[{\"text\":\"Button 1\", \"url\":\"https://example.com\"}]]\nOr type /skip for no buttons.");
        } else if (adminState === 'admin_broadcast_awaiting_buttons_json') {
            let buttons = null;
            let proceed = true;
            if (text !== '/skip' && text !== `/skip@${botUsername}`) {
                try {
                    buttons = JSON.parse(text);
                    if (!Array.isArray(buttons) || !buttons.every(row => Array.isArray(row) && row.every(btn => typeof btn === 'object' && btn.text))) {
                        await bot.sendMessage(ADMIN_ID, "Invalid button JSON structure. Please try again or type /skip.");
                        proceed = false;
                    }
                } catch (e) {
                    await bot.sendMessage(ADMIN_ID, "Invalid JSON format for buttons. Please try again or type /skip.");
                    proceed = false;
                }
            }
            if (proceed) {
                saveChatStateSync(ADMIN_ID, 'admin_broadcast_confirm_advanced', { ...adminData, text: adminData.text, buttons: buttons });
                const buttonsPreview = buttons ? `\nButtons JSON:\n${JSON.stringify(buttons, null, 2)}` : "\n(No inline buttons)";
                await bot.sendMessage(ADMIN_ID, `Advanced broadcast content:\nText:\n${adminData.text}${buttonsPreview}\n\nConfirm send?`, {
                    reply_markup: { inline_keyboard: [[{text: "✅ Send Advanced", callback_data: "bc_confirm_send_advanced"}, {text: "❌ Cancel", callback_data: "bc_cancel_broadcast_setup"}]] }
                });
            }
        }
        return;
    }

    if (text === '🎥 YouTube URL Shortener') {
        await bot.sendMessage(chatId, "📹 Please send the YouTube URL to shorten.");
        saveChatStateSync(chatId, 'awaiting_youtube_url');
    } else if (text === '🌐 Regular URL Shortener') {
        await bot.sendMessage(chatId, "🔗 Please send the URL you want to shorten.");
        saveChatStateSync(chatId, 'awaiting_regular_url');
    } else if (text === '📊 View Users' && isAdmin) {
        const userData = getUserDataSync();
        if (Object.keys(userData).length > 0) {
            let reportMessage = "User Data: \n";
            for (const userId in userData) {
                const data = userData[userId];
                reportMessage += `\nUser ID: ${String(userId)}\n`;
                reportMessage += `URLs Shortened: ${String(data.url_count)}\n`;
                if (data.urls && Array.isArray(data.urls)) data.urls.forEach(urlInfo => { reportMessage += `   Original: ${urlInfo.original}\n   Shortened: ${urlInfo.shortened}\n`; });
            }
            await sendChunkedMessage(bot, chatId, reportMessage);
        } else await bot.sendMessage(chatId, "No user data available.");
    } else if (text === '📈 Bot Stats' && isAdmin) {
        const userData = getUserDataSync(); const allChatStates = getAllChatStatesSync(); const uptime = getBotUptime();
        const totalUniqueUsers = Object.keys(userData).length; let totalUrlsShortened = 0;
        for (const userId in userData) totalUrlsShortened += userData[userId].url_count || 0;
        const activeUserSessions = Object.keys(allChatStates).length; const stateCounts = {};
        for (const userId in allChatStates) { const stateName = allChatStates[userId].state; stateCounts[stateName] = (stateCounts[stateName] || 0) + 1; }
        let activeStatesSummary = "No active user states.";
        if (activeUserSessions > 0) activeStatesSummary = Object.entries(stateCounts).map(([state, count]) => `  - ${state}: ${String(count)} user(s)`).join('\n');
        let statsMessage = `Bot Statistics 📈\n\nBot Uptime: ${uptime}\n\nTotal Unique Users: ${String(totalUniqueUsers)}\nTotal URLs Shortened: ${String(totalUrlsShortened)}\n\nActive Sessions/States: ${String(activeUserSessions)}\n${activeStatesSummary}\n\nData File Info:\n`;
        try {
            if (fs.existsSync(USER_DATA_FILE)) { const stats = fs.statSync(USER_DATA_FILE); statsMessage += `  - ${USER_DATA_FILE}: ${String((stats.size / 1024).toFixed(2))}KB, Mod: ${new Date(stats.mtime).toLocaleString()}\n`; } else statsMessage += `  - ${USER_DATA_FILE}: Not found\n`;
            if (fs.existsSync(USER_STATES_FILE)) { const stats = fs.statSync(USER_STATES_FILE); statsMessage += `  - ${USER_STATES_FILE}: ${String((stats.size / 1024).toFixed(2))}KB, Mod: ${new Date(stats.mtime).toLocaleString()}\n`; } else statsMessage += `  - ${USER_STATES_FILE}: Not found\n`;
        } catch (e) { console.error(`Error getting file stats:`, e); statsMessage += `  - Error accessing file statistics.\n`; }
        statsMessage += `\nStats generated: ${new Date().toLocaleString()}`;
        await sendChunkedMessage(bot, chatId, statsMessage);
    } else if (text === '📢 Broadcast Message' && isAdmin) {
        const broadcastOptions = {
            inline_keyboard: [
                [{ text: "Plain Text", callback_data: "bc_type_text" }],
                [{ text: "Photo with Caption", callback_data: "bc_type_photo" }],
                [{ text: "Video with Caption", callback_data: "bc_type_video" }],
                [{ text: "Text with Inline Buttons", callback_data: "bc_type_advanced_text" }],
                [{ text: "Cancel Setup", callback_data: "bc_cancel_broadcast_setup"}]
            ]
        };
        await bot.sendMessage(chatId, "📢 Select the type of broadcast message:", { reply_markup: broadcastOptions });
    }
    else if (currentChatState && !currentChatState.state.startsWith('admin_broadcast_')) {
        switch (currentChatState.state) {
            case 'awaiting_youtube_url':
                if (isValidUrl(text)) {
                    await bot.sendMessage(chatId, "⏳ Processing YouTube URL...");
                    const videoDetails = await getYouTubeVideoDetails(text);
                    if (videoDetails) {
                        const shortLinks = await shortenUrl(text, videoDetails.title, videoDetails.thumbnail, String(chatId));
                        if (shortLinks) {
                            saveUserDataSync(chatId, text, shortLinks.linkForSaving);
                            let respMsg = `URLs:\nV1: ${shortLinks.v1}\nV2: ${shortLinks.v2}\nV3: ${shortLinks.v3}\n\nTitle: ${videoDetails.title}\nThumbnail: ${videoDetails.thumbnail}`;
                            await bot.sendMessage(chatId, respMsg, { reply_markup: {inline_keyboard: [[{ text: '🚀 Start Another Bot', url: 'http://t.me/selfes_hack_robot' }]]}, disable_web_page_preview: false });
                        } else await bot.sendMessage(chatId, "🚧 Shortening failed.");
                    } else await bot.sendMessage(chatId, "📹 Video details not found.");
                    clearChatStateSync(chatId);
                } else await bot.sendMessage(chatId, "❌ Invalid YouTube URL.");
                break;
            case 'awaiting_regular_url':
                if (isValidUrl(text)) {
                    await bot.sendMessage(chatId, "📝 Please send the custom title for this URL.");
                    saveChatStateSync(chatId, 'awaiting_custom_title', { url: text });
                } else await bot.sendMessage(chatId, "❌ Invalid URL format.");
                break;
            case 'awaiting_custom_title':
                const urlData = currentChatState.data;
                urlData.title = text;
                await bot.sendMessage(chatId, "🖼️ Now, please send the direct image URL for the preview.");
                saveChatStateSync(chatId, 'awaiting_custom_image', urlData);
                break;
            case 'awaiting_custom_image':
                if (isValidUrl(text)) {
                    const customData = currentChatState.data;
                    customData.image = text;
                    await bot.sendMessage(chatId, "⏳ Processing your custom URL... please wait.");
                    const shortLinks = await shortenUrl(customData.url, customData.title, customData.image, String(chatId));
                    if (shortLinks) {
                        saveUserDataSync(chatId, customData.url, shortLinks.linkForSaving);
                        let respMsg = `URLs with custom settings:\nV1: ${shortLinks.v1}\nV2: ${shortLinks.v2}\nV3: ${shortLinks.v3}\n\nTitle: ${customData.title}\nImage: ${customData.image}`;
                        await bot.sendMessage(chatId, respMsg, { reply_markup: {inline_keyboard: [[{ text: '🚀 Start Another Bot', url: 'http://t.me/selfes_hack_robot?start' }]]}, disable_web_page_preview: false });
                    } else await bot.sendMessage(chatId, "🚧 Custom URL request failed.");
                    clearChatStateSync(chatId);
                } else await bot.sendMessage(chatId, "❌ Invalid image URL format.");
                break;
            default: await bot.sendMessage(chatId, "❓ Unknown state. Use /start to reset."); clearChatStateSync(chatId); break;
        }
    } else if (text && !isAdmin && !currentChatState) {
        await bot.sendMessage(chatId, "❓ I didn't understand that. Please use /start or select an option.");
    }
});

bot.on('photo', async (msg) => {
    const chatId = msg.chat.id;
    if (String(chatId) !== ADMIN_ID) return;
    const adminState = getChatStateSync(ADMIN_ID);
    if (adminState && adminState.state === 'admin_broadcast_awaiting_photo') {
        const photoFileId = msg.photo[msg.photo.length - 1].file_id;
        saveChatStateSync(ADMIN_ID, 'admin_broadcast_awaiting_photo_caption', { photo_file_id: photoFileId });
        await bot.sendMessage(ADMIN_ID, "🖼️ Photo received. Now, send a caption for the photo, or type /skip for no caption.");
    }
});

bot.on('video', async (msg) => {
    const chatId = msg.chat.id;
    if (String(chatId) !== ADMIN_ID) return;
    const adminState = getChatStateSync(ADMIN_ID);
    if (adminState && adminState.state === 'admin_broadcast_awaiting_video') {
        const videoFileId = msg.video.file_id;
        saveChatStateSync(ADMIN_ID, 'admin_broadcast_awaiting_video_caption', { video_file_id: videoFileId });
        await bot.sendMessage(ADMIN_ID, "📹 Video received. Now, send a caption for the video, or type /skip for no caption.");
    }
});

bot.on('polling_error', (error) => console.error(`Polling error:`, error.code, error.message || error));
bot.on('webhook_error', (error) => console.error(`Webhook error:`, error.code, error.message || error));

setInterval(keepAlive, KEEP_ALIVE_INTERVAL);

console.log(`Bot is running and listening for messages...`);
