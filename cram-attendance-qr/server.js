const express = require('express');
const { google } = require('googleapis');
const path = require('path');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

const app = express();
const port = 3000;

// ===== 認證與設定 =====
const SERVICE_ACCOUNT = require('./credentials.json');

const SHEET_IDS = [
  '1SOTkqaIN3g4Spk0Cri4F1mEzdiD1xvLzR5x5KLmhrmY',  // 國中
  '14k7fkfiPdhrSnYPXLJ7--8s_Qk3wehI0AZDpgFw83AM',  // 先修
  '1c7zuwUaz-gzY0hbDDO2coixOcQLGhbZbdUXZ9X63Wfo'   // 兒美
];

const auth = new google.auth.GoogleAuth({
  credentials: SERVICE_ACCOUNT,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

// ===== /attend 接收簽到請求 =====
app.get('/attend', async (req, res) => {
  console.log('=== 收到簽到請求 ===');
  
  try {
    const token = req.query.token;
    if (!token) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>錯誤</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; text-align: center; }
            h2 { color: #dc3545; }
          </style>
        </head>
        <body>
          <h2>❌ 缺少簽到代碼</h2>
          <p>請使用正確的 QR Code 掃描</p>
        </body>
        </html>
      `);
    }

    const studentId = Buffer.from(token, 'base64').toString('utf-8').trim();
    const now = dayjs().tz('Asia/Taipei');
    const today = now.format('YYYY-MM-DD'); // 例如 2025-01-15
    const time = now.format('HH:mm');        // 例如 14:30
    const datetime = now.format('YYYY/MM/DD HH:mm');

    console.log('學號:', studentId);
    console.log('今天日期:', today);
    console.log('簽到時間:', time);

    // 遍歷所有試算表
    for (const sheetId of SHEET_IDS) {
      const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
      const sheetTitle = meta.data.sheets[0].properties.title;

      const resData = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: `${sheetTitle}!A1:Z1000`,
      });

      if (!resData.data.values || resData.data.values.length === 0) {
        console.log(`${sheetTitle} 沒有資料，跳過`);
        continue;
      }

      const [header, ...rows] = resData.data.values;
      const idCol = header.indexOf('學號');
      const dateCol = header.indexOf(today);

      console.log(`\n檢查 ${sheetTitle}:`);
      console.log('  學號欄位索引:', idCol);
      console.log('  日期欄位索引:', dateCol);

      if (idCol === -1) {
        console.log('  ❌ 找不到學號欄位');
        continue;
      }

      if (dateCol === -1) {
        console.log('  ❌ 找不到今天的日期欄位:', today);
        continue;
      }

      // 尋找學生
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if ((row[idCol] || '').trim() === studentId) {
          console.log('  ✅ 找到學生！在第', i + 2, '行');
          
          const rowNumber = i + 2;
          const colLetter = String.fromCharCode(65 + dateCol); // A, B, C...
          const cell = `${colLetter}${rowNumber}`;
          
          // 檢查是否已經簽到
          const currentValue = row[dateCol] || '';
          if (currentValue.includes('出席')) {
            console.log('  ⚠️ 該學生已經簽到過了');
            return res.send(`
              <!DOCTYPE html>
              <html>
              <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>已簽到</title>
                <style>
                  body { font-family: Arial, sans-serif; padding: 20px; text-align: center; }
                  h2 { color: #ffc107; }
                  .info { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; }
                </style>
              </head>
              <body>
                <h2>⚠️ 你已經簽到過了</h2>
                <div class="info">
                  <p>原簽到記錄：${currentValue}</p>
                </div>
              </body>
              </html>
            `);
          }

          // 更新簽到狀態
          await sheets.spreadsheets.values.update({
            spreadsheetId: sheetId,
            range: `${sheetTitle}!${cell}`,
            valueInputOption: 'USER_ENTERED',
            resource: {
              values: [[`出席 ${time}`]],
            },
          });

          console.log('  ✅ 簽到成功！');

          return res.send(`
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>簽到成功</title>
              <style>
                body { font-family: Arial, sans-serif; padding: 20px; text-align: center; }
                h2 { color: #28a745; }
                .success { background: #d4edda; color: #155724; padding: 15px; border-radius: 5px; margin: 20px 0; }
                .info { margin-top: 20px; }
                .info p { margin: 5px 0; }
              </style>
            </head>
            <body>
              <h2>✅ 簽到成功！</h2>
              <div class="success">
                <p><strong>簽到時間：</strong>${datetime}</p>
              </div>
              <div class="info">
                <p>學號：${studentId}</p>
                <p>班級：${sheetTitle}</p>
              </div>
            </body>
            </html>
          `);
        }
      }
    }

    // 找不到學生
    console.log('❌ 在所有試算表都找不到學號:', studentId);
    
    res.status(404).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>簽到失敗</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; text-align: center; }
          h2 { color: #dc3545; }
          .error { background: #f8d7da; color: #721c24; padding: 15px; border-radius: 5px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <h2>❌ 簽到失敗</h2>
        <div class="error">
          <p>找不到學號或尚未建立今日欄位</p>
          <p>請聯絡教務老師確認 QR code 與出席表格</p>
        </div>
        <p style="color: #666; font-size: 14px;">學號：${studentId}</p>
      </body>
      </html>
    `);
    
  } catch (error) {
    console.error('💥 錯誤:', error);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>系統錯誤</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; text-align: center; }
          h2 { color: #dc3545; }
        </style>
      </head>
      <body>
        <h2>❌ 系統錯誤</h2>
        <p>伺服器發生錯誤，請稍後再試</p>
        <p style="color: #666; font-size: 14px;">如果問題持續，請聯絡系統管理員</p>
      </body>
      </html>
    `);
  }
});

// ⚠️ 靜態資源要放在路由之後！
app.use('/qrcodes', express.static(path.join(__dirname, 'public/qrcodes')));

app.listen(port, () => {
  console.log(`✅ 點名系統啟動成功！`);
  console.log(`📍 服務網址：http://localhost:${port}`);
  console.log(`📱 掃描 QR Code 後會導向：http://localhost:${port}/attend?token=xxx`);
  console.log(`\n等待學生掃描 QR Code 簽到...\n`);
});