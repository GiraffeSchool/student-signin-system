require('dotenv').config();
const { google } = require('googleapis');
const SERVICE_ACCOUNT = require('./credentials.json');

// 用你想測的 Google Sheet ID
const SHEET_ID = '1SOTkqaIN3g4Spk0Cri4F1mEzdiD1xvLzR5x5KLmhrmY'; // 你國中的那個

async function main() {
  const auth = new google.auth.GoogleAuth({
    credentials: SERVICE_ACCOUNT,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  // 讀取指定分頁（假設你的分頁名叫「國二菁英」）
  const sheetTitle = '國二菁英'; // 直接寫死，方便測試

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${sheetTitle}!A1:Z30`,
  });

  const rows = res.data.values;
  if (!rows || rows.length === 0) {
    console.log('No data found.');
    return;
  }
  // 印出 header 跟第一行
  console.log('Header:', rows[0]);
  for (let i = 1; i < rows.length; i++) {
    console.log(rows[i]);
  }
}

main().catch(console.error);
