// api/health.js - 系統健康檢查端點（中文版，檢查所有試算表）
const { google } = require('googleapis');
const axios = require('axios');

// Google Sheets 設定 - 與主系統相同
const SHEET_IDS = [
  { id: '1SOTkqaIN3g4Spk0Cri4F1mEzdiD1xvLzR5x5KLmhrmY', name: '國中' },
  { id: '14k7fkfiPdhrSnYPXLJ7--8s_Qk3wehI0AZDpgFw83AM', name: '先修' },
  { id: '1c7zuwUaz-gzY0hbDDO2coixOcQLGhbZbdUXZ9X63Wfo', name: '兒美' }
];

// 解析 Google 憑證
const getGoogleAuth = () => {
  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    return new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
  } catch (error) {
    return null;
  }
};

module.exports = async (req, res) => {
  const startTime = Date.now();
  
  const healthCheck = {
    狀態: '健康',
    時間戳記: new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }),
    服務狀態: {
      API服務: '運作中',
      Google試算表: '檢查中',
      LINE機器人: '檢查中',
      環境設定: '檢查中'
    },
    試算表狀態: {}, // 每個試算表的狀態
    效能: {
      回應時間: 0
    },
    錯誤: []
  };

  // 1. 檢查環境變數
  try {
    const requiredEnvVars = [
      'LINE_CHANNEL_ACCESS_TOKEN',
      'LINE_CHANNEL_SECRET',
      'GOOGLE_SERVICE_ACCOUNT'
    ];
    
    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      healthCheck.服務狀態.環境設定 = '部分異常';
      healthCheck.錯誤.push({
        服務: '環境設定',
        訊息: `缺少環境變數：${missingVars.join(', ')}`
      });
      healthCheck.狀態 = '部分異常';
    } else {
      healthCheck.服務狀態.環境設定 = '正常';
    }
  } catch (error) {
    healthCheck.服務狀態.環境設定 = '錯誤';
    healthCheck.錯誤.push({
      服務: '環境設定',
      訊息: error.message
    });
  }

  // 2. 測試所有 Google Sheets 連線
  try {
    const auth = getGoogleAuth();
    if (!auth) {
      throw new Error('Google 認證設定錯誤');
    }
    
    const sheets = google.sheets({ version: 'v4', auth });
    let allSheetsOk = true;
    let accessibleSheets = 0;
    
    // 檢查每個試算表
    for (const sheet of SHEET_IDS) {
      try {
        const response = await sheets.spreadsheets.get({
          spreadsheetId: sheet.id,
          fields: 'properties.title,sheets.properties.title'
        });
        
        healthCheck.試算表狀態[sheet.name] = {
          狀態: '可存取',
          標題: response.data.properties.title,
          工作表: response.data.sheets.map(s => s.properties.title),
          ID: sheet.id
        };
        accessibleSheets++;
      } catch (sheetError) {
        allSheetsOk = false;
        healthCheck.試算表狀態[sheet.name] = {
          狀態: '錯誤',
          錯誤訊息: sheetError.message,
          ID: sheet.id
        };
        
        // 根據錯誤類型提供更友善的中文訊息
        let friendlyError = '無法存取試算表';
        if (sheetError.message.includes('permission')) {
          friendlyError = '沒有存取權限';
        } else if (sheetError.message.includes('not found')) {
          friendlyError = '找不到試算表';
        } else if (sheetError.message.includes('quota')) {
          friendlyError = 'API 配額超過限制';
        }
        
        healthCheck.錯誤.push({
          服務: 'Google試算表',
          試算表: sheet.name,
          試算表ID: sheet.id,
          訊息: friendlyError,
          詳細錯誤: sheetError.message
        });
      }
    }
    
    // 決定整體 Google Sheets 狀態
    if (accessibleSheets === SHEET_IDS.length) {
      healthCheck.服務狀態.Google試算表 = '正常';
    } else if (accessibleSheets > 0) {
      healthCheck.服務狀態.Google試算表 = '部分異常';
      healthCheck.狀態 = '部分異常';
    } else {
      healthCheck.服務狀態.Google試算表 = '錯誤';
      healthCheck.狀態 = '異常';
    }
    
    // 加入摘要
    healthCheck.試算表摘要 = {
      總數: SHEET_IDS.length,
      可存取: accessibleSheets,
      失敗: SHEET_IDS.length - accessibleSheets,
      狀態說明: `${accessibleSheets}/${SHEET_IDS.length} 個試算表正常`
    };
    
  } catch (error) {
    healthCheck.服務狀態.Google試算表 = '錯誤';
    healthCheck.狀態 = '異常';
    healthCheck.錯誤.push({
      服務: 'Google試算表',
      訊息: error.message,
      建議: '請檢查 Google 服務帳戶憑證'
    });
  }

  // 3. 測試 LINE API 連線
  try {
    if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) {
      throw new Error('LINE Channel Access Token 未設定');
    }
    
    // 測試 LINE API 端點
    const response = await axios.get('https://api.line.me/v2/bot/info', {
      headers: {
        'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
      },
      timeout: 5000
    });
    
    if (response.status === 200) {
      healthCheck.服務狀態.LINE機器人 = '正常';
      healthCheck.機器人資訊 = {
        名稱: response.data.displayName,
        ID: response.data.userId,
        狀態: '運作中'
      };
    }
  } catch (error) {
    healthCheck.服務狀態.LINE機器人 = '錯誤';
    healthCheck.狀態 = healthCheck.狀態 === '健康' ? '部分異常' : healthCheck.狀態;
    
    let errorMessage = 'LINE API 連線失敗';
    if (error.response?.status === 401) {
      errorMessage = 'LINE Channel Access Token 無效';
    } else if (error.code === 'ECONNABORTED') {
      errorMessage = 'LINE API 連線逾時';
    } else if (error.message.includes('ENOTFOUND')) {
      errorMessage = '網路連線問題';
    }
    
    healthCheck.錯誤.push({
      服務: 'LINE機器人',
      訊息: errorMessage,
      詳細錯誤: error.message
    });
  }

  // 4. 計算響應時間
  healthCheck.效能.回應時間 = `${Date.now() - startTime} 毫秒`;
  
  // 5. 加入系統資訊
  const uptimeMinutes = Math.floor(process.uptime() / 60);
  const uptimeHours = Math.floor(uptimeMinutes / 60);
  const uptimeDays = Math.floor(uptimeHours / 24);
  
  let uptimeString = '';
  if (uptimeDays > 0) {
    uptimeString = `${uptimeDays} 天 ${uptimeHours % 24} 小時`;
  } else if (uptimeHours > 0) {
    uptimeString = `${uptimeHours} 小時 ${uptimeMinutes % 60} 分鐘`;
  } else {
    uptimeString = `${uptimeMinutes} 分鐘`;
  }
  
  healthCheck.系統資訊 = {
    Node版本: process.version,
    平台: process.platform === 'linux' ? 'Linux' : process.platform,
    運行時間: uptimeString,
    記憶體使用: {
      已使用: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`,
      總計: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)} MB`,
      使用率: `${Math.round(process.memoryUsage().heapUsed / process.memoryUsage().heapTotal * 100)}%`
    }
  };

  // 6. 決定 HTTP 狀態碼
  let statusCode = 200;
  if (healthCheck.狀態 === '異常') {
    statusCode = 503; // Service Unavailable
  } else if (healthCheck.狀態 === '部分異常') {
    statusCode = 207; // Multi-Status
  }

  // 7. 加入處理建議
  if (healthCheck.錯誤.length > 0) {
    healthCheck.處理建議 = [];
    
    // Google Sheets 相關建議
    const sheetsWithError = healthCheck.錯誤.filter(e => e.服務 === 'Google試算表');
    if (sheetsWithError.length > 0) {
      healthCheck.處理建議.push('【Google 試算表問題】');
      
      const permissionErrors = sheetsWithError.filter(e => e.訊息.includes('權限'));
      if (permissionErrors.length > 0) {
        healthCheck.處理建議.push('1. 請確認服務帳戶有以下試算表的存取權限：');
        permissionErrors.forEach(error => {
          healthCheck.處理建議.push(`   - ${error.試算表}班 (${error.試算表ID})`);
        });
        healthCheck.處理建議.push('2. 在 Google Sheets 中與服務帳戶 email 共用試算表');
      }
      
      const quotaErrors = sheetsWithError.filter(e => e.訊息.includes('配額'));
      if (quotaErrors.length > 0) {
        healthCheck.處理建議.push('1. Google Sheets API 配額已用盡');
        healthCheck.處理建議.push('2. 請到 Google Cloud Console 查看配額使用情況');
        healthCheck.處理建議.push('3. 考慮申請提高配額限制');
      }
    }
    
    // LINE Bot 相關建議
    if (healthCheck.服務狀態.LINE機器人 === '錯誤') {
      healthCheck.處理建議.push('【LINE 機器人問題】');
      healthCheck.處理建議.push('1. 檢查 LINE Channel Access Token 是否已過期');
      healthCheck.處理建議.push('2. 到 LINE Developers Console 重新產生 Token');
      healthCheck.處理建議.push('3. 更新 Vercel 環境變數中的 Token');
    }
    
    // 環境設定相關建議
    if (healthCheck.服務狀態.環境設定 !== '正常') {
      healthCheck.處理建議.push('【環境設定問題】');
      healthCheck.處理建議.push('1. 到 Vercel Dashboard 檢查環境變數');
      healthCheck.處理建議.push('2. 確認所有必要的環境變數都已設定');
    }
  }

  // 8. 加入整體狀態說明
  healthCheck.狀態說明 = {
    '健康': '所有服務正常運作',
    '部分異常': '部分服務有問題，但主要功能仍可使用',
    '異常': '關鍵服務故障，系統無法正常運作'
  }[healthCheck.狀態];

  res.status(statusCode).json(healthCheck);
};
