const express = require('express');
const app = express();

console.log('測試伺服器啟動中...');

app.get('/test', (req, res) => {
    console.log('有人訪問 /test 了！');
    res.send('測試成功！');
});

app.listen(3000, () => {
    console.log('伺服器在 port 3000 啟動了');
});