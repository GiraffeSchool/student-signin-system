require('dotenv').config();
const { google } = require('googleapis');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

// 從 .env 抓網址，提供預設值
const QR_BASE_URL = process.env.QR_BASE_URL || 'http://localhost:3000/attend?token=';

// 檢查環境變數
if (!process.env.QR_BASE_URL) {
  console.log('⚠️  警告: QR_BASE_URL 未設定，使用預設值:', QR_BASE_URL);
}

// 三個 Google Sheet 的 ID
const SHEET_IDS = [
  '1SOTkqaIN3g4Spk0Cri4F1mEzdiD1xvLzR5x5KLmhrmY',  // 國中
  '14k7fkfiPdhrSnYPXLJ7--8s_Qk3wehI0AZDpgFw83AM',  // 先修
  '1c7zuwUaz-gzY0hbDDO2coixOcQLGhbZbdUXZ9X63Wfo'   // 兒美
];

// Google Cloud 下載下來的 JSON 憑證
// 修正路徑：根據你的專案結構調整
const SERVICE_ACCOUNT = require('../credentials.json');

// QR code 圖片存放路徑
const OUTPUT_QR_DIR = './public/qrcodes';

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: SERVICE_ACCOUNT,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function fetchSheetData(sheetId, sheetName) {
  try {
    const sheets = await getSheetsClient();
    
    // 先取得試算表資訊
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    const sheetTitle = meta.data.sheets[0].properties.title;
    console.log(`📊 處理 ${sheetName} - Sheet: ${sheetTitle}`);
    
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${sheetTitle}!A1:Z1000`, // 使用實際的 sheet 名稱
    });
    
    if (!res.data.values || res.data.values.length === 0) {
      console.log(`⚠️  ${sheetName} 沒有資料`);
      return [];
    }
    
    const [header, ...rows] = res.data.values;
    console.log(`   找到 ${rows.length} 筆學生資料`);
    
    return rows.map(row => {
      let obj = {};
      header.forEach((col, idx) => obj[col] = row[idx] || '');
      return obj;
    });
  } catch (error) {
    console.error(`❌ 讀取 ${sheetName} 失敗:`, error.message);
    return [];
  }
}

// 用學號產生唯一 token
function makeToken(student) {
  if (!student['學號']) {
    console.log(`⚠️  學生 ${student['姓名'] || '未知'} 缺少學號，跳過`);
    return null;
  }
  // 移除結尾的 = 號使 URL 更乾淨
  return Buffer.from(student['學號']).toString('base64').replace(/=+$/, '');
}

// 產生 QR code 圖片，命名為 學號-姓名.png
async function generateQR(token, student) {
  try {
    // 確保 URL 格式正確
    const baseUrl = QR_BASE_URL.endsWith('=') ? QR_BASE_URL : QR_BASE_URL + '=';
    const url = baseUrl + token;
    console.log(`[Debug] QR URL for ${student['學號']}: ${url}`);

    // 安全的檔名（移除特殊字元）
    const safeName = student['姓名'].replace(/[<>:"/\\|?*]/g, '');
    const outFile = path.join(OUTPUT_QR_DIR, `${student['學號']}-${safeName}.png`);
    
    await QRCode.toFile(outFile, url, { 
      width: 320,
      margin: 1,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });
    
    return outFile;
  } catch (error) {
    console.error(`❌ 產生 QR code 失敗 (${student['學號']}):`, error.message);
    return null;
  }
}

async function main() {
  console.log('🚀 開始產生 QR Code...');
  console.log(`📁 輸出目錄: ${OUTPUT_QR_DIR}`);
  console.log(`🌐 Base URL: ${QR_BASE_URL}`);
  console.log('');
  
  // 建立輸出目錄
  if (!fs.existsSync(OUTPUT_QR_DIR)) {
    fs.mkdirSync(OUTPUT_QR_DIR, { recursive: true });
    console.log('✅ 建立輸出目錄');
  }
  
  // 統計資訊
  let totalGenerated = 0;
  let totalSkipped = 0;
  
  const sheetNames = ['國中', '先修', '兒美'];
  
  for (let i = 0; i < SHEET_IDS.length; i++) {
    const sheetId = SHEET_IDS[i];
    const sheetName = sheetNames[i];
    
    console.log(`\n========== ${sheetName} ==========`);
    
    const students = await fetchSheetData(sheetId, sheetName);
    
    for (const student of students) {
      // 檢查必要欄位
      if (!student['姓名'] || !student['學號']) {
        console.log(`   ⚠️  跳過：缺少必要資料 (姓名: ${student['姓名'] || '無'}, 學號: ${student['學號'] || '無'})`);
        totalSkipped++;
        continue;
      }
      
      const token = makeToken(student);
      if (!token) {
        totalSkipped++;
        continue;
      }
      
      const outFile = await generateQR(token, student);
      if (outFile) {
        console.log(`   ✅ ${student['學號']} - ${student['姓名']} (${student['班級'] || '未分班'})`);
        totalGenerated++;
      } else {
        totalSkipped++;
      }
    }
  }
  
  console.log('\n========== 完成 ==========');
  console.log(`✅ 成功產生: ${totalGenerated} 個 QR Code`);
  console.log(`⚠️  跳過: ${totalSkipped} 筆資料`);
  console.log(`📁 檔案位置: ${path.resolve(OUTPUT_QR_DIR)}`);
}

// 執行主程式
main().catch(error => {
  console.error('💥 程式執行失敗:', error);
  process.exit(1);
});