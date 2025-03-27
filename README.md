# PDF翻译工具

这是一个基于Node.js的PDF文档翻译工具，支持将PDF文件翻译成中文。

## 功能特点

- 支持PDF文件上传和翻译
- 多种翻译API支持（硅基流动API、Google翻译、DeepSeek）
- 自动分段翻译，避免API限制
- 实时显示翻译进度
- 支持断点续传
- 自动保存翻译结果
- 支持章节识别和分段下载

## 安装

1. 克隆仓库：
```bash
git clone https://github.com/yourusername/pdf-translator.git
cd pdf-translator
```

2. 安装依赖：
```bash
npm install
```

3. 创建环境配置文件：
```bash
cp .env.example .env
```

4. 配置环境变量：
在 `.env` 文件中设置以下变量：
```
PORT=3030
SILICONFLOW_API_KEY=your_api_key
GOOGLE_API_KEY=your_api_key
DEEPSEEK_API_KEY=your_api_key
TRANSLATOR_API=SILICON  # 可选：SILICON, GOOGLE, DEEPSEEK
TRANSLATE_DELAY=1000    # API请求间隔（毫秒）
```

## 使用方法

1. 启动服务：
```bash
node server.js
```

2. 访问网页界面：
打开浏览器访问 `http://localhost:3030`

3. 上传PDF文件并等待翻译完成

## 注意事项

- 请确保有足够的API余额
- 大文件翻译可能需要较长时间
- 建议使用Chrome或Firefox浏览器
- 翻译过程中请保持网络连接

## 许可证

MIT License 