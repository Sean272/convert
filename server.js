/**
 * EPUB转PDF服务器
 * 提供Web界面允许用户上传EPUB文件并转换为PDF
 */

const express = require('express');
const multer = require('multer');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { convertEpubToPdf } = require('./converter');
require('dotenv').config();

// 配置常量
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');
const TEMP_DIR = path.join(__dirname, 'temp');
const CLEANUP_INTERVAL_HOURS = parseInt(process.env.CLEANUP_INTERVAL_HOURS || 24); // 默认24小时
const FILE_SIZE_LIMIT = parseInt(process.env.FILE_SIZE_LIMIT || 50) * 1024 * 1024; // 默认50MB

// 存储任务状态
const tasks = {};

const app = express();
const PORT = process.env.PORT || 3030;

// 创建上传和输出目录
fs.ensureDirSync(UPLOAD_DIR);
fs.ensureDirSync(OUTPUT_DIR);
fs.ensureDirSync(TEMP_DIR);

// 设置multer存储选项
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename: function(req, file, cb) {
    // 使用原始文件名，但添加UUID以避免冲突
    const taskId = uuidv4();
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const safeFilename = originalName.replace(/[^\w\s.-]/g, '_');
    const filename = `${safeFilename}-${taskId}${path.extname(file.originalname)}`;
    req.taskId = taskId;
    req.originalFilename = originalName;
    cb(null, filename);
  }
});

const upload = multer({
  storage: storage,
  fileFilter: function(req, file, cb) {
    // 检查是否是EPUB文件
    if (!isValidEpubFile(file)) {
      return cb(new Error('只允许上传EPUB文件'));
    }
    cb(null, true);
  },
  limits: {
    fileSize: FILE_SIZE_LIMIT
  }
});

// 定期清理过期任务和临时文件
function cleanupOldFiles() {
  console.log('开始清理过期文件和任务...');
  const now = new Date();
  
  // 清理过期任务
  Object.keys(tasks).forEach(taskId => {
    const task = tasks[taskId];
    if (task.createdAt) {
      const ageHours = (now - new Date(task.createdAt)) / (1000 * 60 * 60);
      if (ageHours > CLEANUP_INTERVAL_HOURS) {
        console.log(`删除过期任务: ${taskId}`);
        delete tasks[taskId];
      }
    }
  });
  
  // 清理过期上传文件
  [UPLOAD_DIR, OUTPUT_DIR, TEMP_DIR].forEach(dir => {
    fs.readdir(dir, (err, files) => {
      if (err) {
        console.error(`读取目录失败: ${dir}, ${err}`);
        return;
      }
      
      files.forEach(file => {
        const filePath = path.join(dir, file);
        fs.stat(filePath, (err, stats) => {
          if (err) {
            console.error(`读取文件状态失败: ${filePath}, ${err}`);
            return;
          }
          
          const ageHours = (now - stats.mtime) / (1000 * 60 * 60);
          if (ageHours > CLEANUP_INTERVAL_HOURS) {
            fs.remove(filePath, err => {
              if (err) {
                console.error(`删除过期文件失败: ${filePath}, ${err}`);
              } else {
                console.log(`已删除过期文件: ${filePath}`);
              }
            });
          }
        });
      });
    });
  });
}

// 每小时运行一次清理
setInterval(cleanupOldFiles, 1000 * 60 * 60);

// 检查文件是否为EPUB
function isValidEpubFile(file) {
  // 检查扩展名
  const ext = path.extname(file.originalname).toLowerCase();
  return ext === '.epub';
}

// 配置express
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/outputs', express.static(OUTPUT_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// 路由
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 转换状态API
app.get('/api/tasks/:taskId', (req, res) => {
  const taskId = req.params.taskId;
  if (tasks[taskId]) {
    res.json(tasks[taskId]);
  } else {
    res.status(404).json({ error: '任务不存在' });
  }
});

// 文件上传和转换API
app.post('/api/convert', upload.single('epub'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '没有上传文件' });
  }
  
  const taskId = req.taskId;
  const originalFilename = req.originalFilename;
  const epubPath = req.file.path;
  const outputFilename = `${path.basename(req.file.originalname, '.epub')}-${taskId}.pdf`;
  const outputPath = path.join(OUTPUT_DIR, outputFilename);
  const tempDir = path.join(TEMP_DIR, taskId);
  
  console.log(`接收到新的转换请求：原始文件=${originalFilename}, 任务ID=${taskId}, EPUB路径=${epubPath}, 输出PDF=${outputPath}`);
  
  // 创建任务状态对象
  tasks[taskId] = {
    id: taskId,
    originalFilename,
    epubPath,
    outputPath,
    status: 'processing',
    stage: 'uploading',
    progress: 0,
    message: '文件已上传，准备处理...',
    result: null,
    error: null,
    createdAt: new Date().toISOString()
  };
  
  // 返回初始响应
  res.json({ 
    taskId, 
    message: '文件已上传，开始转换处理' 
  });
  
  try {
    // 创建临时目录
    await fs.ensureDir(tempDir);
    
    // 进度回调函数
    const progressCallback = (progressPercent, message) => {
      const task = tasks[taskId];
      if (task) {
        // 处理错误情况
        if (message && message.toLowerCase().includes('错误')) {
          task.status = 'failed';
          task.error = message;
          task.stage = 'error';
          return;
        }
        
        // 根据进度百分比确定阶段
        let stage = 'processing';
        if (progressPercent <= 20) {
          stage = 'preprocessing';
        } else if (progressPercent <= 40) {
          stage = 'extracting';
        } else if (progressPercent <= 60) {
          stage = 'generating';
        } else if (progressPercent <= 90) {
          stage = 'converting';
        } else if (progressPercent >= 100) {
          stage = 'done';
          task.status = 'completed';
        }
        
        task.progress = Math.min(100, Math.floor(progressPercent));
        task.stage = stage;
        task.message = message || '处理中...';
        
        console.log(`任务 [${taskId}]: ${stage} - ${task.message} (${task.progress}%)`);
      }
    };
    
    // 执行转换
    console.log(`开始转换EPUB到PDF: ${epubPath} -> ${outputPath}`);
    const result = await convertEpubToPdf(epubPath, outputPath, progressCallback, { tempDir });
    
    // 更新任务状态
    tasks[taskId].status = 'completed';
    tasks[taskId].progress = 100;
    tasks[taskId].stage = 'done';
    tasks[taskId].message = '转换完成';
    tasks[taskId].result = {
      pdfPath: path.basename(result),
      pdfUrl: `/outputs/${path.basename(result)}`
    };
    
    console.log(`任务 [${taskId}]: 转换成功! PDF路径: ${result}`);
    
    // 转换完成后删除上传的EPUB文件
    try {
      await fs.unlink(epubPath);
      console.log(`任务 [${taskId}]: 已清理上传的EPUB文件`);
    } catch (cleanupError) {
      console.warn(`任务 [${taskId}]: 清理上传文件失败: ${cleanupError.message}`);
    }
    
    // 设置任务状态过期时间
    setTimeout(() => {
      if (tasks[taskId]) {
        console.log(`删除过期任务: ${taskId}`);
        delete tasks[taskId];
      }
    }, 1000 * 60 * 60 * CLEANUP_INTERVAL_HOURS);
    
  } catch (error) {
    console.error(`转换失败: ${error.message}`);
    
    // 更新任务状态为失败
    tasks[taskId].status = 'failed';
    tasks[taskId].stage = 'error';
    tasks[taskId].message = `转换失败: ${error.message}`;
    tasks[taskId].error = error.message;
    tasks[taskId].progress = 0;
    
    // 清理临时文件
    try {
      await fs.remove(tempDir);
      console.log(`已清理临时目录: ${tempDir}`);
    } catch (cleanupError) {
      console.warn(`清理临时目录失败: ${cleanupError.message}`);
    }
  }
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`服务已启动，访问 http://localhost:${PORT} 使用转换工具`);
  
  // 确保必要的目录存在
  fs.ensureDirSync(UPLOAD_DIR);
  fs.ensureDirSync(OUTPUT_DIR);
  fs.ensureDirSync(TEMP_DIR);
  
  // 启动时执行一次清理
  cleanupOldFiles();
});

// 捕获未处理的异常
process.on('uncaughtException', (error) => {
  console.error('未捕获的异常:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('未处理的Promise拒绝:', reason);
}); 