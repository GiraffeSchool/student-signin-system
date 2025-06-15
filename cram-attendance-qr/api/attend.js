// api/attend.js - 處理簽到請求
const { google } = require('googleapis');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const axios = require('axios');

dayjs.extend(utc);
dayjs.extend(timezone);

// 補習班位置設定
const SCHOOL_LAT = 22.583300782581;
const SCHOOL_LNG = 120.35373872070156;
const ALLOWED_DISTANCE = 0.1; // 100 公尺

// LINE Bot 設定
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_PUSH_API = 'https://api.line.me/v2/bot/message/push';

// Google Sheets 設定
const SHEET_IDS = [
  '1SOTkqaIN3g4Spk0Cri4F1mEzdiD1xvLzR5x5KLmhrmY',  // 國中
  '14k7fkfiPdhrSnYPXLJ7--8s_Qk3wehI0AZDpgFw83AM',  // 先修
  '1c7zuwUaz-gzY0hbDDO2coixOcQLGhbZbdUXZ9X63Wfo'   // 兒美
];

// 計算兩點距離（公里）
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // 地球半徑（公里）
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// 解析 Google 憑證
const getGoogleAuth = () => {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
};

// LINE 推送訊息
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

module.exports = async (req, res) => {
  // 只接受 POST 請求
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  console.log('=== 收到簽到請求 ===');
  try {
    const { token, latitude, longitude } = req.body;
    
    if (!token) {
      return res.status(400).send('❌ 缺少簽到代碼');
    }
    
    if (!latitude || !longitude) {
      return res.status(400).send('❌ 缺少位置資訊');
    }
    
    // 驗證位置
    const distance = calculateDistance(SCHOOL_LAT, SCHOOL_LNG, latitude, longitude);
    console.log(`位置驗證 - 距離: ${distance.toFixed(3)} 公里`);
    
    if (distance > ALLOWED_DISTANCE) {
      return res.status(403).send(`❌ 您不在補習班範圍內<br>目前距離：${(distance * 1000).toFixed(0)} 公尺<br>請在補習班 100 公尺內簽到`);
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
            return res.status(400).send(`⚠️ 你已經簽到過了<br>原簽到記錄：${currentValue}`);
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
            notifyMsg = '<br>✅ 已發送通知給家長';
          } else {
            notifyMsg = '<br>⚠️ 未設定家長 LINE';
          }
          
          return res.send(`✅ 簽到成功！<br><br>簽到時間：${datetime}<br>學號：${studentId}<br>姓名：${studentName}<br>班級：${className}${notifyMsg}`);
        }
      }
    }
    
    res.status(404).send('❌ 簽到失敗<br>找不到學號或尚未建立今日欄位');
  } catch (error) {
    console.error('💥 錯誤:', error);
    res.status(500).send('❌ 系統錯誤<br>伺服器發生錯誤，請稍後再試');
  }
};
