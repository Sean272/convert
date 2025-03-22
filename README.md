# EPUB 转 PDF 工具

这是一个将 EPUB 电子书转换为 PDF 的工具，支持内容翻译功能。通过简单的 Web 界面，用户可以上传 EPUB 文件，选择是否需要翻译，然后下载转换好的 PDF 文件。

## 功能特点

- 将 EPUB 文件转换为 PDF 格式
- 支持内容翻译功能 (支持多种翻译 API)
- 简洁的 Web 界面
- 异步处理队列
- 进度实时反馈
- 自动清理临时文件

## 安装步骤

### 前提条件

- Node.js (v14 或更高版本)
- npm 或 yarn

### 安装

1. 克隆代码库：

```bash
git clone https://github.com/yourusername/epub-to-pdf-converter.git
cd epub-to-pdf-converter
```

2. 安装依赖：

```bash
npm install
# 或者使用 yarn
yarn install
```

3. 配置环境变量：

```bash
cp .env.example .env
```

然后编辑 `.env` 文件，根据需要配置 API 密钥和其他设置。

### 配置说明

在 `.env` 文件中，您可以配置以下内容：

- `TRANSLATOR_API`: 翻译 API 选择 (GOOGLE, SILICONFLOW, DEEPSEEK, SIMULATE)
- `SILICONFLOW_API_KEY`: SiliconFlow API 密钥 (如果使用 SiliconFlow 翻译)
- `DEEPSEEK_API_KEY`: DeepSeek API 密钥 (如果使用 DeepSeek 翻译)
- `MAX_TRANSLATE_LENGTH`: 单次翻译的最大字符数
- `TRANSLATE_DELAY`: 翻译请求之间的延迟时间 (毫秒)
- `PORT`: 服务器端口号
- `CLEANUP_INTERVAL_HOURS`: 临时文件保留时间 (小时)
- `FILE_SIZE_LIMIT`: 上传文件大小限制 (MB)

## 运行

启动服务器：

```bash
npm start
# 或者使用 yarn
yarn start
```

然后在浏览器中访问 `http://localhost:3030`（或您在 `.env` 中配置的端口）。

## 使用方法

1. 在浏览器中打开应用
2. 点击"选择文件"按钮，选择要转换的 EPUB 文件
3. 根据需要勾选"翻译内容"选项
4. 点击"上传并转换"按钮
5. 等待转换完成，可以看到实时进度反馈
6. 转换完成后，点击"下载 PDF"按钮下载转换后的文件

## 翻译 API 说明

本工具支持多种翻译 API：

- **Google 翻译**: 免费使用，但有请求频率限制
- **SiliconFlow**: 硅基流动提供的 DeepSeek API 服务，需要 API 密钥
- **DeepSeek**: DeepSeek 官方 API，需要 API 密钥
- **模拟翻译**: 离线的简单翻译词典，不需要网络连接，但翻译质量有限

如果在线翻译 API 失败，系统会自动降级到模拟翻译模式，确保转换过程不会中断。

## 项目结构

- `server.js`: Web 服务器主文件
- `converter.js`: EPUB 到 PDF 转换核心逻辑
- `public/`: 前端界面文件
- `uploads/`: 上传的 EPUB 文件暂存目录
- `outputs/`: 生成的 PDF 文件存储目录
- `temp/`: 转换过程中的临时文件目录

## 许可证

MIT 