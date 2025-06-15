// api/sign.js - 顯示簽到頁面
module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = req.query.token;
  if (!token) {
    return res.send('<h2>❌ 無效的簽到連結</h2>');
  }
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>育名補習班簽到系統</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          max-width: 600px;
          margin: 50px auto;
          padding: 20px;
          text-align: center;
        }
        .container {
          background: #f5f5f5;
          padding: 30px;
          border-radius: 10px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 {
          color: #333;
          margin-bottom: 30px;
        }
        .btn {
          background: #007bff;
          color: white;
          padding: 15px 30px;
          border: none;
          border-radius: 5px;
          font-size: 18px;
          cursor: pointer;
          margin: 10px;
        }
        .btn:disabled {
          background: #ccc;
          cursor: not-allowed;
        }
        .btn-success {
          background: #28a745;
        }
        .btn-danger {
          background: #dc3545;
        }
        #status {
          margin: 20px 0;
          padding: 15px;
          border-radius: 5px;
        }
        .success {
          background: #d4edda;
          color: #155724;
          border: 1px solid #c3e6cb;
        }
        .error {
          background: #f8d7da;
          color: #721c24;
          border: 1px solid #f5c6cb;
        }
        .loading {
          background: #cfe2ff;
          color: #084298;
          border: 1px solid #b6d4fe;
        }
        .spinner {
          display: inline-block;
          width: 20px;
          height: 20px;
          border: 3px solid #f3f3f3;
          border-top: 3px solid #007bff;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin-right: 10px;
          vertical-align: middle;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>育名補習班簽到系統</h1>
        <div id="status" class="loading">
          <span class="spinner"></span>正在準備簽到...
        </div>
        <button id="retryBtn" class="btn" onclick="startSign()" style="display:none;">重新簽到</button>
      </div>

      <script>
        const token = '${token}';
        
        function showStatus(message, type) {
          const status = document.getElementById('status');
          status.className = type;
          status.innerHTML = message;
          status.style.display = 'block';
        }
        
        function showRetryButton() {
          document.getElementById('retryBtn').style.display = 'inline-block';
        }
        
        async function startSign() {
          const retryBtn = document.getElementById('retryBtn');
          retryBtn.style.display = 'none';
          
          showStatus('<span class="spinner"></span>正在取得您的位置...', 'loading');
          
          if (!navigator.geolocation) {
            showStatus('❌ 您的瀏覽器不支援定位功能', 'error');
            showRetryButton();
            return;
          }
          
          navigator.geolocation.getCurrentPosition(
            async (position) => {
              const lat = position.coords.latitude;
              const lng = position.coords.longitude;
              
              showStatus('<span class="spinner"></span>正在驗證位置並簽到...', 'loading');
              
              try {
                const response = await fetch('/api/attend', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    token: token,
                    latitude: lat,
                    longitude: lng
                  })
                });
                
                const result = await response.text();
                
                if (response.ok) {
                  showStatus(result, 'success');
                } else {
                  showStatus(result, 'error');
                  showRetryButton();
                }
              } catch (error) {
                showStatus('❌ 網路錯誤，請稍後再試', 'error');
                showRetryButton();
              }
            },
            (error) => {
              let errorMsg = '❌ 無法取得位置：';
              switch(error.code) {
                case error.PERMISSION_DENIED:
                  errorMsg += '您拒絕了位置存取權限，請允許存取位置後重試';
                  break;
                case error.POSITION_UNAVAILABLE:
                  errorMsg += '無法取得位置資訊';
                  break;
                case error.TIMEOUT:
                  errorMsg += '取得位置逾時';
                  break;
                default:
                  errorMsg += '未知錯誤';
              }
              showStatus(errorMsg, 'error');
              showRetryButton();
            },
            {
              enableHighAccuracy: true,
              timeout: 10000,
              maximumAge: 0
            }
          );
        }
        
        // 頁面載入後自動開始簽到
        window.onload = function() {
          startSign();
        };
      </script>
    </body>
    </html>
  `);
};
