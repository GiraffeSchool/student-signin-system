// index.js - 合併靜態資源 + LINE通知 + Google Sheets簽到
require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const crypto = require('crypto');
const axios = require('axios');
const path = require('path');

dayjs.extend(utc);
dayjs.extend(timezone);

const app = express();

// Middleware
app.use(express.json());

// LINE Bot 設定
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const LINE_REPLY_API = 'https://api.line.me/v2/bot/message/reply';
const LINE_PUSH_API = 'https://api.line.me/v2/bot/message/push';

// Google Sheets 設定
const SHEET_IDS = [
  '1SOTkqaIN3g4Spk0Cri4F1mEzdiD1xvLzR5x5KLmhrmY',  // 國中
  '14k7fkfiPdhrSnYPXLJ7--8s_Qk3wehI0AZDpgFw83AM',  // 先修
  '1c7zuwUaz-gzY0hbDDO2coixOcQLGhbZbdUXZ9X63Wfo'   // 兒美
];

// 解析 Google 憑證
const getGoogleAuth = () => {
  const credentials = process.env.GOOGLE_SERVICE_ACCOUNT 
    ? JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT)
    : require('./credentials.json'); // 注意：和 server.js 一樣放同目錄
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
};

// ===== LINE Webhook 驗證 =====
function validateLineSignature(body, signature) {
  if (!LINE_CHANNEL_SECRET || !signature) return false;
  const hash = crypto
    .createHmac('sha256', LINE_CHANNEL_SECRET)
    .update(JSON.stringify(body))
    .digest('base64');
  return hash === signature;
}

// ===== LINE 回覆訊息 =====
async function replyMessage(replyToken, messages) {
  try {
    await axios.post(LINE_REPLY_API, {
      replyToken,
      messages
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
      }
    });
    console.log('訊息回覆成功');
  } catch (error) {
    console.error('回覆訊息失敗:', error.response?.data || error.message);
  }
}

// ===== LINE 推送訊息（簽到通知用）=====
async function pushMessage(to, messages) {
  if (!LINE_CHANNEL_ACCESS_TOKEN || !to) {
    console.log('無法發送 LINE 通知：缺少 token 或收件者');
    return;
  }
  try {
    await axios.post(LINE_PUSH_API, {
      to,
      messages
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
      }
    });
    console.log('LINE 通知發送成功');
  } catch (error) {
    console.error('推送訊息失敗:', error.response?.data || error.message);
  }
}

// ===== LINE Webhook 處理（家長加好友時自動回傳 User ID）=====
app.post('/api/webhook', async (req, res) => {
  console.log('收到 LINE Webhook');
  // 驗證簽名
  const signature = req.headers['x-line-signature'];
  if (!validateLineSignature(req.body, signature)) {
    console.log('簽名驗證失敗');
    return res.status(403).json({ error: 'Invalid signature' });
  }

  const events = req.body.events || [];
  for (const event of events) {
    // 處理加好友事件 - 自動回傳 User ID
    if (event.type === 'follow') {
      const userId = event.source.userId;
      const replyToken = event.replyToken;
      console.log('新用戶加入:', userId);
      // 自動回傳 User ID 給家長
      await replyMessage(replyToken, [
        {
          type: 'text',
          text: `歡迎加入育名補習班點名通知系統！\n\n您的 LINE User ID 是：\n${userId}\n\n請將此 ID 提供給補習班老師，以便設定簽到通知。`
        },
        {
          type: 'text',
          text: '設定完成後，當您的孩子簽到時，您將會收到即時通知。\n\n如需再次查詢您的 User ID，請輸入「我的ID」。'
        }
      ]);
    }
    // 處理文字訊息
    if (event.type === 'message' && event.message.type === 'text') {
      const userId = event.source.userId;
      const text = event.message.text.trim();
      const replyToken = event.replyToken;
      console.log('收到訊息:', text, 'from', userId);
      // 查詢 User ID
      if (['我的ID', 'ID', 'id', '我的id'].includes(text)) {
        await replyMessage(replyToken, [{
          type: 'text',
          text: `您的 LINE User ID 是：\n${userId}\n\n請將此 ID 提供給補習班老師。`
        }]);
      } else if (['說明', '功能', 'help'].includes(text)) {
        await replyMessage(replyToken, [{
          type: 'text',
          text: '育名補習班點名通知系統\n\n功能說明：\n1. 輸入「我的ID」查詢您的 User ID\n2. 將 User ID 提供給老師\n3. 設定完成後會收到孩子的簽到通知\n\n如有問題請聯絡補習班。'
        }]);
      }
    }
  }
  res.json({ success: true });
});

// ===== /api/attend 接收簽到請求（包含發送 LINE 通知）=====
// ===== /api/attend 接收簽到請求（包含發送 LINE 通知）=====
app.get('/api/attend', async (req, res) => {
  console.log('=== 收到簽到請求 ===');
  try {
    const token = req.query.token;
    if (!token) {
      return res.status(400).send(`<h2>❌ 缺少簽到代碼</h2>`);
    }
    const studentId = Buffer.from(token, 'base64').toString('utf-8').trim();
    const now = dayjs().tz('Asia/Taipei');
    const today = now.format('YYYY-MM-DD');
    const time = now.format('HH:mm');
    const datetime = now.format('YYYY/MM/DD HH:mm');
    console.log('學號:', studentId, '今天日期:', today, '簽到時間:', time);

    const auth = getGoogleAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    for (const sheetId of SHEET_IDS) {
      const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
      const sheetTitle = meta.data.sheets[0].properties.title;
      const resData = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: `${sheetTitle}!A1:Z1000`,
      });
      if (!resData.data.values || resData.data.values.length === 0) continue;
      const [header, ...rows] = resData.data.values;
      const idCol = header.indexOf('學號');
      const dateCol = header.indexOf(today);
      const nameCol = header.indexOf('姓名');
      const classCol = header.indexOf('班級');
      // 找所有包含「家長LINE」的欄位
      const parentLineCols = header
        .map((h, idx) => (h && h.includes('家長LINE')) ? idx : -1)
        .filter(idx => idx !== -1);

      if (idCol === -1 || dateCol === -1) continue;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if ((row[idCol] || '').trim() === studentId) {
          const rowNumber = i + 2;
          const colLetter = String.fromCharCode(65 + dateCol);
          const cell = `${colLetter}${rowNumber}`;
          const currentValue = row[dateCol] || '';
          if (currentValue.includes('出席')) {
            return res.send(`<h2>⚠️ 你已經簽到過了</h2><p>原簽到記錄：${currentValue}</p>`);
          }
          // 更新簽到
          await sheets.spreadsheets.values.update({
            spreadsheetId: sheetId,
            range: `${sheetTitle}!${cell}`,
            valueInputOption: 'USER_ENTERED',
            resource: {
              values: [[`出席 ${time}`]],
            },
          });
          // 發送 LINE 通知（多家長欄位）
          const studentName = nameCol !== -1 ? row[nameCol] : '';
          const className = classCol !== -1 ? row[classCol] : sheetTitle;
          // 所有家長ID（有U開頭）
          const parentLineIds = parentLineCols
            .map(idx => row[idx])
            .filter(id => id && id.startsWith('U'));
          let notifyMsg = '';
          if (parentLineIds.length > 0 && LINE_CHANNEL_ACCESS_TOKEN) {
            for (const lineId of parentLineIds) {
              await pushMessage(lineId, [{
                type: 'text',
                text: `【簽到通知】\n您的孩子 ${studentName} 已於 ${datetime} 完成簽到。\n班級：${className}\n\n祝學習愉快！`
              }]);
            }
            notifyMsg = '<p>✅ 已發送通知給家長</p>';
          } else {
            notifyMsg = '<p>⚠️ 未設定家長 LINE</p>';
          }
          return res.send(`<h2>✅ 簽到成功！</h2><p>簽到時間：${datetime}</p><p>學號：${studentId}</p><p>姓名：${studentName}</p><p>班級：${className}</p>${notifyMsg}`);
        }
      }
    }
    res.status(404).send(`<h2>❌ 簽到失敗</h2><p>找不到學號或尚未建立今日欄位</p>`);
  } catch (error) {
    console.error('💥 錯誤:', error);
    res.status(500).send(`<h2>❌ 系統錯誤</h2><p>伺服器發生錯誤，請稍後再試</p>`);
  }
});
