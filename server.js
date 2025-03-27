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
const { translateWithGoogle, translateWithSiliconFlow, translateWithDeepSeek, simulateTranslation } = require('./converter');
require('dotenv').config();

// 任务状态更新函数
function updateTaskStatus(taskId, status, progress, message, error = null) {
  // 确保任务存在
  if (!tasks[taskId]) {
    console.error(`无法更新不存在的任务: ${taskId}`);
    return false;
  }
  
  // 更新任务状态
  if (status) tasks[taskId].status = status;
  if (typeof progress === 'number') tasks[taskId].progress = progress;
  if (message) tasks[taskId].message = message;
  if (error) tasks[taskId].error = error;
  
  console.log(`更新任务状态 ${taskId}: ${status}, 进度: ${progress}%, 消息: ${message}`);
  return true;
}

// 配置常量
const PORT = process.env.PORT || 3030;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');
const TEMP_DIR = path.join(__dirname, 'temp');
const CLEANUP_INTERVAL_HOURS = parseInt(process.env.CLEANUP_INTERVAL_HOURS || 24); // 默认24小时
const FILE_SIZE_LIMIT = parseInt(process.env.FILE_SIZE_LIMIT || 50) * 1024 * 1024; // 默认50MB
const TASK_EXPIRE_INTERVAL = 24 * 60 * 60 * 1000; // 24小时后任务过期

// 存储任务状态
const tasks = {};

const app = express();

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
    // 处理原始文件名，确保使用UTF-8编码
    let originalName = '';
    try {
      originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    } catch (e) {
      // 如果转换失败，使用简单文件名
      originalName = `file-${Date.now()}`;
      console.error(`文件名编码转换失败: ${e.message}`);
    }
    
    // 使用简短安全的文件名，避免过长和特殊字符问题
    const safeFilename = `epub-${taskId}${path.extname(file.originalname)}`;
    
    // 保存原始文件名供显示使用
    req.taskId = taskId;
    req.originalFilename = originalName;
    
    // 记录文件名处理信息
    console.log(`原始文件名: ${file.originalname}`);
    console.log(`处理后文件名: ${safeFilename}`);
    
    cb(null, safeFilename);
  }
});

// 检查文件是否为EPUB
function isValidEpubFile(file) {
  // 检查扩展名
  const ext = path.extname(file.originalname).toLowerCase();
  return ext === '.epub';
}

// 检查文件是否为PDF
function isValidPdfFile(file) {
  // 检查扩展名
  const ext = path.extname(file.originalname).toLowerCase();
  return ext === '.pdf';
}

// 设置上传配置
const epubUpload = multer({
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

// 设置PDF上传配置
const pdfStorage = multer.diskStorage({
  destination: function(req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename: function(req, file, cb) {
    // 使用原始文件名，但添加UUID以避免冲突
    const taskId = uuidv4();
    // 处理原始文件名，确保使用UTF-8编码
    let originalName = '';
    try {
      originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    } catch (e) {
      // 如果转换失败，使用简单文件名
      originalName = `file-${Date.now()}`;
      console.error(`文件名编码转换失败: ${e.message}`);
    }
    
    // 使用简短安全的文件名，避免过长和特殊字符问题
    const safeFilename = `pdf-${taskId}${path.extname(file.originalname)}`;
    
    // 保存原始文件名供显示使用
    req.taskId = taskId;
    req.originalFilename = originalName;
    
    // 记录文件名处理信息
    console.log(`原始文件名: ${file.originalname}`);
    console.log(`处理后文件名: ${safeFilename}`);
    
    cb(null, safeFilename);
  }
});

const pdfUpload = multer({
  storage: pdfStorage,
  fileFilter: function(req, file, cb) {
    // 检查是否是PDF文件
    if (!isValidPdfFile(file)) {
      return cb(new Error('只允许上传PDF文件'));
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

// 配置express
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/outputs', express.static(OUTPUT_DIR));

// 为静态文件设置无缓存
const staticOptions = {
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
  }
};

app.use(express.static(path.join(__dirname, 'public'), staticOptions));

// 路由
app.get('/', (req, res) => {
  // 添加无缓存头部
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 设置状态检查API
app.get('/api/status/:taskId', (req, res) => {
  const taskId = req.params.taskId;
  if (tasks[taskId]) {
    res.json({
      status: tasks[taskId].status,
      progress: tasks[taskId].progress,
      message: tasks[taskId].message,
      error: tasks[taskId].error,
      chapters: tasks[taskId].chapterFiles,
      downloadUrl: tasks[taskId].result?.translationUrl
    });
  } else {
    res.status(404).json({
      error: '任务未找到'
    });
  }
});

// 获取任务的所有章节信息
app.get('/api/chapters/:taskId', (req, res) => {
  const taskId = req.params.taskId;
  
  if (!tasks[taskId]) {
    return res.status(404).json({ error: '任务未找到' });
  }
  
  if (!tasks[taskId].chapterFiles) {
    return res.status(404).json({ error: '该任务没有章节信息或尚未完成' });
  }
  
  res.json({
    task: taskId,
    filename: path.basename(tasks[taskId].translationPath),
    chapters: tasks[taskId].chapterFiles
  });
});

// 获取所有已恢复的任务
app.get('/api/restored-tasks', (req, res) => {
  const restoredTasks = [];
  
  // 遍历所有任务
  for (const taskId in tasks) {
    if (tasks[taskId].isRestored) {
      restoredTasks.push({
        id: taskId,
        title: tasks[taskId].pdfName || `恢复的任务 ${taskId.substring(0, 8)}`,
        status: tasks[taskId].status,
        progress: tasks[taskId].progress,
        message: tasks[taskId].message,
        error: tasks[taskId].error,
        createdAt: tasks[taskId].createdAt,
        hasChapters: Array.isArray(tasks[taskId].chapterFiles) && tasks[taskId].chapterFiles.length > 0,
        downloadUrl: tasks[taskId].result?.translationUrl
      });
    }
  }
  
  res.json({
    success: true,
    tasks: restoredTasks
  });
});

// 下载章节翻译文件
app.get('/download-chapter/:taskId/:filename', (req, res) => {
  const taskId = req.params.taskId;
  const filename = req.params.filename;
  const filePath = path.join(__dirname, 'temp', taskId, filename);
  
  // 检查文件是否存在
  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).send('章节文件未找到');
  }
});

// 设置文件下载API
app.get('/download/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(__dirname, 'outputs', filename);
  
  // 检查文件是否存在
  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).send('文件未找到');
  }
});

// 文件上传和转换API
app.post('/api/convert', epubUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '未收到文件' });
    }

    console.log('原始文件名:', req.file.originalname);
    console.log('处理后文件名:', req.file.filename);
    console.log('收到文件上传请求:', req.file);

    // 验证是否为EPUB文件
    if (!isValidEpubFile(req.file)) {
      return res.status(400).json({ error: '仅支持EPUB文件格式' });
    }

    // 生成唯一任务ID
    const taskId = req.taskId || uuidv4();
    
    // 创建任务目录结构
    const taskDir = path.join(TEMP_DIR, taskId);
    const taskOutputDir = path.join(OUTPUT_DIR, taskId);
    await fs.mkdir(taskDir, { recursive: true });
    await fs.mkdir(taskOutputDir, { recursive: true });
    
    // 保存任务状态
    tasks[taskId] = {
      id: taskId,
      status: 'pending',
      message: '准备开始转换...',
      progress: 0,
      timestamp: Date.now(),
      filePath: req.file.path,
      outputPath: null,
      translationPath: null,
      originalFilename: req.file.originalname,
      error: null
    };
    
    // 返回任务ID，前端可以用此ID查询进度
    res.json({ 
      taskId, 
      status: 'pending',
      message: '任务已创建，正在处理中...' 
    });
    
    // 异步处理转换任务
    processConversionTask(taskId, req.file.path, taskOutputDir, req.file.originalname)
      .catch(err => {
        console.error('转换过程出错:', err);
        tasks[taskId].status = 'error';
        tasks[taskId].error = err.message;
        tasks[taskId].message = '转换失败: ' + err.message;
      });
      
  } catch (error) {
    console.error('处理上传请求失败:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 新增API端点：仅翻译PDF文件
app.post('/api/translate-pdf', pdfUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '未收到文件' });
    }

    console.log('原始文件名:', req.file.originalname);
    console.log('处理后文件名:', req.file.filename);
    console.log('收到PDF翻译请求:', req.file);

    // 验证是否为PDF文件
    if (!isValidPdfFile(req.file)) {
      return res.status(400).json({ error: '仅支持PDF文件格式' });
    }

    // 生成唯一任务ID
    const taskId = req.taskId || uuidv4();
    
    // 创建任务目录结构
    const taskDir = path.join(TEMP_DIR, taskId);
    const taskOutputDir = path.join(OUTPUT_DIR, taskId);
    await fs.mkdir(taskDir, { recursive: true });
    await fs.mkdir(taskOutputDir, { recursive: true });
    
    // 保存任务状态
    tasks[taskId] = {
      id: taskId,
      status: 'pending',
      message: '准备开始翻译PDF...',
      progress: 0,
      timestamp: Date.now(),
      filePath: req.file.path,
      outputPath: null,
      translationPath: null,
      originalFilename: req.file.originalname,
      error: null
    };
    
    // 返回任务ID，前端可以用此ID查询进度
    res.json({ 
      taskId, 
      status: 'pending',
      message: '翻译任务已创建，正在处理中...' 
    });
    
    // 异步处理翻译任务
    processTranslatePdfTask(taskId, req.file.path, taskOutputDir, req.file.originalname)
      .catch(err => {
        console.error('PDF翻译过程出错:', err);
        tasks[taskId].status = 'error';
        tasks[taskId].error = err.message;
        tasks[taskId].message = '翻译失败: ' + err.message;
      });
      
  } catch (error) {
    console.error('处理PDF翻译请求失败:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 取消任务
app.post('/api/cancel/:taskId', (req, res) => {
  const taskId = req.params.taskId;
  
  if (tasks[taskId]) {
    console.log(`用户请求取消任务: ${taskId}`);
    
    // 标记任务为已完成状态，停止处理
    tasks[taskId].status = 'completed';
    tasks[taskId].progress = 100;
    tasks[taskId].message = '任务已由用户取消';
    tasks[taskId].isCancelled = true;
    
    res.json({
      success: true,
      message: '任务已取消'
    });
  } else {
    res.status(404).json({
      success: false,
      message: '任务未找到'
    });
  }
});

// 恢复翻译任务
app.post('/api/resume-translation/:taskId', pdfUpload.single('pdf'), async (req, res) => {
  try {
    const { taskId } = req.params;
    if (!req.file) {
      return res.status(400).json({ success: false, message: '请上传PDF文件' });
    }
    
    const result = await resumeTranslationTask(taskId, req.file.path);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
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

  // 扫描并恢复未完成的翻译任务
  restoreUnfinishedTasks();
});

/**
 * 扫描并恢复未完成的翻译任务
 * 在服务器重启后，检查临时目录中的翻译文件，恢复未完成的任务
 */
async function restoreUnfinishedTasks() {
  console.log('开始扫描未完成的翻译任务...');
  try {
    // 读取临时目录
    const dirs = await fs.readdir(TEMP_DIR);
    
    // 筛选出可能的任务ID目录（UUID格式）
    const taskDirs = dirs.filter(dir => {
      // UUID格式通常为8-4-4-4-12位字符
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(dir);
    });
    
    console.log(`找到 ${taskDirs.length} 个可能未完成的任务目录`);
    
    for (const taskId of taskDirs) {
      // 检查是否已经有这个任务ID在当前任务列表中
      if (tasks[taskId]) {
        console.log(`任务 ${taskId} 已经在进行中，跳过恢复`);
        continue;
      }
      
      // 读取任务目录内容
      const taskDir = path.join(TEMP_DIR, taskId);
      const files = await fs.readdir(taskDir);
      
      // 检查是否有章节或段落文件
      const chapterFiles = files.filter(file => 
        file.startsWith(taskId) && 
        (file.includes('_chapter_') || file.includes('_segment_'))
      );
      
      if (chapterFiles.length === 0) {
        console.log(`任务 ${taskId} 没有找到章节或段落文件，跳过恢复`);
        continue;
      }
      
      // 尝试从文件名提取原始PDF名称
      let pdfName = '';
      const pdfFile = path.join(UPLOAD_DIR, `pdf-${taskId}.pdf`);
      let pdfExists = await fs.pathExists(pdfFile);
      
      // 查找已存在的段落文件
      let lastSegmentNumber = 0;
      const segmentFiles = files.filter(file => file.includes('_segment_')).sort();
      
      if (segmentFiles.length > 0) {
        // 从最后一个段落文件名提取序号
        const lastSegmentFile = segmentFiles[segmentFiles.length - 1];
        const match = lastSegmentFile.match(/_segment_(\d+)\.txt$/);
        if (match) {
          lastSegmentNumber = parseInt(match[1]);
        }
      }
      
      // 读取第一个段落文件以提取原始文件名
      if (segmentFiles.length > 0) {
        const firstSegmentContent = await fs.readFile(path.join(taskDir, segmentFiles[0]), 'utf8');
        const titleMatch = firstSegmentContent.match(/《(.+?)》/);
        if (titleMatch) {
          pdfName = titleMatch[1];
        }
      }
      
      // 创建恢复的任务对象
      tasks[taskId] = {
        id: taskId,
        pdfName: pdfName || `已恢复的任务-${taskId}`,
        status: 'translating',
        progress: Math.min(50 + Math.floor((lastSegmentNumber / 20) * 40), 95), // 根据段落数估算进度
        message: `已恢复翻译任务，当前已翻译 ${lastSegmentNumber} 个段落`,
        error: null,
        createdAt: new Date(),
        isRestored: true,
        lastProcessedSegment: lastSegmentNumber,
        chapterFiles: []
      };
      
      // 处理章节文件信息
      for (const file of chapterFiles) {
        const isChapter = file.includes('_chapter_');
        const isSegment = file.includes('_segment_');
        let number = 0;
        let title = '';
        
        if (isChapter) {
          const match = file.match(/_chapter_(\d+)\.txt$/);
          if (match) {
            number = parseInt(match[1]);
            title = `章节 ${number}`;
          }
        } else if (isSegment) {
          const match = file.match(/_segment_(\d+)\.txt$/);
          if (match) {
            number = parseInt(match[1]);
            title = `段落片段 ${number}`;
          }
        }
        
        tasks[taskId].chapterFiles.push({
          number: number,
          title: title,
          filename: file
        });
      }
      
      console.log(`成功恢复任务 ${taskId}，找到 ${chapterFiles.length} 个已翻译的章节或段落`);
      
      // 如果PDF文件存在，继续处理
      if (pdfExists) {
        console.log(`为任务 ${taskId} 恢复翻译过程，继续翻译剩余内容`);
        
        // 创建任务输出目录
        const taskOutputDir = path.join(OUTPUT_DIR, taskId);
        await fs.ensureDir(taskOutputDir);
        
        // 异步重启翻译过程
        processTranslatePdfTask(taskId, pdfFile, taskOutputDir, `restored-${pdfName || taskId}.pdf`)
          .catch(err => {
            console.error(`恢复翻译任务 ${taskId} 失败:`, err);
            tasks[taskId].status = 'error';
            tasks[taskId].error = `恢复翻译失败: ${err.message}`;
            tasks[taskId].message = `恢复翻译失败: ${err.message}`;
          });
      } else {
        console.log(`任务 ${taskId} 的PDF文件不存在，标记为已完成状态`);
        
        // 如果无法继续翻译，则将任务标记为已完成
        tasks[taskId].status = 'completed';
        tasks[taskId].progress = 100;
        tasks[taskId].message = '翻译已从缓存中恢复，PDF原文件已不存在';
        
        // 生成翻译文件
        try {
          // 收集已有翻译内容
          const existingTranslations = [];
          
          // 按序号排序章节文件
          const sortedChapterFiles = [...tasks[taskId].chapterFiles]
            .sort((a, b) => a.number - b.number);
          
          for (const chapterInfo of sortedChapterFiles) {
            if (!chapterInfo.filename) continue;
            
            const filePath = path.join(taskDir, chapterInfo.filename);
            if (await fs.pathExists(filePath)) {
              const content = await fs.readFile(filePath, 'utf8');
              // 提取标题信息
              const titleLine = content.split('\n')[0];
              const titleMatch = titleLine.match(/《(.+?)》/);
              let docTitle = '';
              
              if (titleMatch) {
                docTitle = titleMatch[1];
              }
              
              // 合并已有翻译
              existingTranslations.push(content);
              
              // 设置任务属性
              if (docTitle && !tasks[taskId].translationTitle) {
                tasks[taskId].translationTitle = docTitle;
              }
            }
          }
          
          // 创建完整翻译文件
          if (existingTranslations.length > 0) {
            const translationTitle = tasks[taskId].translationTitle || 
                                     tasks[taskId].pdfName || 
                                     `已恢复任务-${taskId}`;
            
            const truncatedTitle = translationTitle.length > 60
              ? translationTitle.substring(0, 60) + '...'
              : translationTitle;
              
            const translationFilename = `${truncatedTitle}-translation-${taskId}.txt`;
            const translationPath = path.join(OUTPUT_DIR, translationFilename);
            
            // 写入合并的翻译文件
            await fs.writeFile(translationPath, existingTranslations.join('\n\n'));
            
            // 设置下载链接
            const downloadPath = `/outputs/${path.basename(translationPath)}`;
            tasks[taskId].translationPath = translationPath;
            tasks[taskId].result = {
              translationPath: translationPath,
              translationUrl: downloadPath,
              chapterFiles: tasks[taskId].chapterFiles
            };
            
            console.log(`成功为任务 ${taskId} 创建恢复的翻译文件: ${translationPath}`);
          }
        } catch (error) {
          console.error(`为任务 ${taskId} 创建恢复的翻译文件时出错:`, error);
        }
      }
    }
    
    console.log('恢复未完成任务完成');
  } catch (error) {
    console.error('恢复未完成任务时出错:', error);
  }
}

// 捕获未处理的异常
process.on('uncaughtException', (error) => {
  console.error('未捕获的异常:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('未处理的Promise拒绝:', reason);
});

// 处理PDF直接翻译任务
async function processTranslatePdfTask(taskId, pdfPath, outputDir, originalFilename) {
  try {
    // 检查是否是恢复的任务
    const isRestored = tasks[taskId]?.isRestored === true;
    const lastProcessedSegment = tasks[taskId]?.lastProcessedSegment || 0;
    
    if (isRestored) {
      console.log(`恢复任务 ${taskId} 的翻译，从段落 ${lastProcessedSegment + 1} 开始`);
    } else {
      // 更新任务状态
      tasks[taskId].status = 'processing';
      tasks[taskId].message = '开始翻译PDF文件...';
      tasks[taskId].progress = 10;
    }
    
    // 设置输出文件路径
    const outputBasename = path.basename(originalFilename, '.pdf');
    const truncatedName = outputBasename.length > 60 
      ? outputBasename.substring(0, 60) + '...' 
      : outputBasename;
    const translationFilename = `${truncatedName}-translation-${taskId}.txt`;
    const translationPath = path.join(OUTPUT_DIR, translationFilename);
    
    // 创建临时目录用于存储段落文件
    const tempDir = path.join('temp', taskId);
    await fs.ensureDir(tempDir);
    
    // 记录文件路径信息
    console.log(`设置翻译文件路径: ${translationPath}`);
    console.log(`临时文件目录: ${tempDir}`);
    
    // 更新任务状态
    tasks[taskId].status = 'translating';
    tasks[taskId].translationPath = translationPath;
    tasks[taskId].tempDir = tempDir;
    
    // 导入PDF处理和翻译功能
    const { extractTextFromPdf } = require('./converter');
    
    // 如果不是恢复的任务，需要从头开始提取PDF文本
    let pdfText = '';
    if (!isRestored) {
      // 更新任务状态
      tasks[taskId].status = 'extracting';
      tasks[taskId].message = '提取PDF文本内容...';
      tasks[taskId].progress = 20;
      
      // 提取PDF文本
      pdfText = await extractTextFromPdf(pdfPath, (progress, message) => {
        const overallProgress = 20 + Math.floor(progress * 30);
        tasks[taskId].progress = Math.min(overallProgress, 50);
        tasks[taskId].message = message;
      });
    } else {
      // 对于恢复的任务，直接从PDF文件读取内容
      if (await fs.pathExists(pdfPath)) {
        pdfText = await extractTextFromPdf(pdfPath, () => {});
        console.log(`已从PDF重新提取文本，长度: ${pdfText.length} 字符`);
      } else {
        console.log(`无法找到原始PDF文件: ${pdfPath}，只处理已翻译的部分`);
      }
    }
    
    // 更新任务状态
    tasks[taskId].status = 'translating';
    if (!isRestored) {
      tasks[taskId].message = '开始翻译文本...';
      tasks[taskId].progress = 50;
    }
    
    // 为章节文件创建临时目录
    const chapterDir = path.join('temp', taskId);
    await fs.ensureDir(chapterDir);
    
    // 将长文本分段翻译，并尝试识别章节
    // 首先按段落分割文本
    const rawParagraphs = pdfText.split('\n\n').filter(p => p.trim().length > 0);
    
    // 优化段落切分，确保每个段落在句子边界处结束
    const paragraphs = [];
    let currentParagraph = '';
    
    // 句子结束标记（英文句号、问号、感叹号后跟空格或换行符）
    const sentenceEndPattern = /[.!?。！？][\s\n]+/;
    
    // 处理每个原始段落
    for (const rawParagraph of rawParagraphs) {
      if (rawParagraph.trim().length < 5) {
        // 对于非常短的段落，直接添加
        paragraphs.push(rawParagraph);
        continue;
      }
      
      // 将当前段落添加到累积段落
      if (currentParagraph) {
        currentParagraph += '\n\n' + rawParagraph;
      } else {
        currentParagraph = rawParagraph;
      }
      
      // 检查当前累积段落是否在句子边界结束
      if (sentenceEndPattern.test(currentParagraph.slice(-5))) {
        paragraphs.push(currentParagraph);
        currentParagraph = '';
      } else if (currentParagraph.length > 5000) {
        // 如果段落太长（超过5000字符），即使没有在句子边界，也强制切分
        // 但会尝试在最后一个句号处切分
        const lastPeriodIndex = currentParagraph.lastIndexOf('. ');
        if (lastPeriodIndex > currentParagraph.length * 0.7) {
          // 只有当最后一个句号位于段落后70%的位置时才在此处切分
          paragraphs.push(currentParagraph.substring(0, lastPeriodIndex + 1));
          currentParagraph = currentParagraph.substring(lastPeriodIndex + 2);
        } else {
          // 否则直接添加整个段落
          paragraphs.push(currentParagraph);
          currentParagraph = '';
        }
      }
    }
    
    // 处理最后可能剩余的段落
    if (currentParagraph.trim()) {
      paragraphs.push(currentParagraph);
    }
    
    let translatedParagraphs = [];
    let totalParagraphs = paragraphs.length;
    
    // 识别可能的章节标题的正则表达式
    const chapterPatterns = [
      /^chapter\s+\d+/i,                      // "Chapter X"
      /^\d+\.\s+.+/,                          // "1. Chapter Title"
      /^第\s*[一二三四五六七八九十百千]+\s*章/,   // "第一章"
      /^第\s*\d+\s*章/,                       // "第1章"
      /^[一二三四五六七八九十]+、/,              // "一、章节内容"
      /^PART\s+\d+/i,                         // "PART X"
      /^Section\s+\d+/i,                      // "Section X"
      /^附录\s+/,                             // "附录 X"
      /^Appendix\s+/i                         // "Appendix X"
    ];
    
    // 初始化章节管理
    let currentChapter = 0;
    let chapterTitle = '引言';
    let chapterContents = [];
    
    // 从任务中加载已有的章节文件
    let chapterFiles = tasks[taskId].chapterFiles || [];
    
    // 计算最大段落编号，用于确定从哪继续翻译
    let maxSegmentNumber = 0;
    if (isRestored && chapterFiles.length > 0) {
      // 对于恢复的任务，查找最大的段落号
      maxSegmentNumber = lastProcessedSegment;
    }
    
    // 用于基于段落数量的分段（如果无法识别章节）
    let paragraphsInCurrentSegment = 0;
    let segmentNumber = maxSegmentNumber;
    const PARAGRAPHS_PER_SEGMENT = 10; // 每个段落文件包含10个段落
    let hasRecognizedChapters = false; // 是否识别到了章节
    
    // 输出正在处理的信息
    console.log(`准备翻译PDF，共 ${totalParagraphs} 个段落，从段落 ${maxSegmentNumber * PARAGRAPHS_PER_SEGMENT + 1} 开始`);
    
    // 从上次的位置继续处理段落
    const startIndex = isRestored ? Math.min(maxSegmentNumber * PARAGRAPHS_PER_SEGMENT, paragraphs.length - 1) : 0;
    
    // 添加任务错误计数器
    let translationErrorCount = 0;
    const maxErrors = 5; // 最大允许错误数
    
    for (let i = startIndex; i < paragraphs.length; i++) {
      try {
        // 更新任务状态
        tasks[taskId].message = `正在翻译段落 ${i+1}/${totalParagraphs}...`;
        tasks[taskId].progress = 50 + Math.floor((i / totalParagraphs) * 40);
        
        const paragraph = paragraphs[i].trim();
        
        // 检查是否是章节标题
        const isChapterTitle = chapterPatterns.some(pattern => pattern.test(paragraph)) || 
                              (paragraph.length < 50 && paragraph.toUpperCase() === paragraph) || // 全大写的短文本可能是标题
                              (paragraph.length < 30 && /^[A-Z][\w\s]+$/.test(paragraph)); // 首字母大写的短句可能是标题
        
        // 如果发现新章节标题，保存当前章节并开始新章节
        if (isChapterTitle && i > 0) {
          hasRecognizedChapters = true;
          
          // 保存前一章节内容
          if (chapterContents.length > 0) {
            const chapterFilename = `${taskId}_chapter_${currentChapter.toString().padStart(3, '0')}.txt`;
            const chapterFilePath = path.join(chapterDir, chapterFilename);
            
            let chapterContent = `======== 《${outputBasename}》- ${chapterTitle} ========\n\n`;
            chapterContent += chapterContents.join('\n\n');
            
            await fs.writeFile(chapterFilePath, chapterContent);
            console.log(`已保存章节 ${currentChapter}: ${chapterTitle} 到 ${chapterFilePath}`);
            
            // 更新任务的章节信息，以便前端可以实时显示和下载
            chapterFiles.push({
              number: currentChapter,
              title: chapterTitle,
              path: chapterFilePath,
              filename: path.basename(chapterFilePath)
            });
            
            // 更新任务中的章节列表，使其立即可见
            tasks[taskId].chapterFiles = chapterFiles.map(ch => ({
              number: ch.number,
              title: ch.title,
              filename: ch.path ? path.basename(ch.path) : `chapter_${ch.number}.txt`
            }));
            
            // 重置章节内容
            chapterContents = [];
          }
          
          // 更新章节信息
          currentChapter++;
          chapterTitle = paragraph;
          // 重置段落段计数器
          paragraphsInCurrentSegment = 0;
        } 
        // 如果没有识别到章节，但已经积累了足够多的段落，则作为一个段落段保存
        else if (!hasRecognizedChapters && paragraphsInCurrentSegment >= PARAGRAPHS_PER_SEGMENT) {
          // 保存当前段落段
          if (chapterContents.length > 0) {
            segmentNumber++;
            const segmentFilename = `${taskId}_segment_${segmentNumber.toString().padStart(3, '0')}.txt`;
            const segmentFilePath = path.join(chapterDir, segmentFilename);
            
            let segmentContent = `======== 《${outputBasename}》- 段落片段 ${segmentNumber} ========\n\n`;
            segmentContent += chapterContents.join('\n\n');
            
            await fs.writeFile(segmentFilePath, segmentContent);
            console.log(`已保存段落片段 ${segmentNumber} 到 ${segmentFilePath}`);
            
            // 更新任务的段落段信息
            chapterFiles.push({
              number: segmentNumber,
              title: `段落片段 ${segmentNumber}`,
              path: segmentFilePath,
              filename: path.basename(segmentFilePath)
            });
            
            // 更新任务中的章节列表
            tasks[taskId].chapterFiles = chapterFiles.map(ch => ({
              number: ch.number,
              title: ch.title,
              filename: ch.path ? path.basename(ch.path) : `chapter_${ch.number}.txt`
            }));
            
            // 重置段落段内容
            chapterContents = [];
            paragraphsInCurrentSegment = 0;
          }
        }
        
        // 跳过非常短的段落
        if (paragraph.length < 5) {
          chapterContents.push(paragraph);
          translatedParagraphs.push(paragraph);
          paragraphsInCurrentSegment++;
          continue;
        }
        
        // 使用带有错误处理的翻译逻辑
        let translatedParagraph = '';
        let translationSuccess = false;
        
        try {
          // 配置了TRANSLATOR_API则优先使用指定的API
          const TRANSLATOR_API = process.env.TRANSLATOR_API || 'SILICON';
          
          // 增加重试次数和延迟
          let retryCount = 0;
          const maxRetries = 3;
          
          while (!translationSuccess && retryCount < maxRetries) {
            try {
              if (TRANSLATOR_API === 'DEEPSEEK') {
                translatedParagraph = await translateWithDeepSeek(paragraph);
              } else if (TRANSLATOR_API === 'GOOGLE') {
                translatedParagraph = await translateWithGoogle(paragraph);
              } else { // 默认使用硅基流动API
                translatedParagraph = await translateWithSiliconFlow(paragraph);
              }
              translationSuccess = true;
            } catch (retryError) {
              console.error(`翻译尝试 #${retryCount + 1} 失败:`, retryError.message);
              retryCount++;
              
              // 如果是API余额不足错误，更新任务状态以通知用户
              if (retryError.message.includes("paid balance is insufficient") || 
                  retryError.message.includes("Forbidden")) {
                console.log("检测到API余额不足，尝试切换到备选翻译方法...");
                
                // 更新任务状态，提醒用户充值
                updateTaskStatus(taskId, "translating", Math.floor((i / paragraphs.length) * 100),
                  `API账户余额不足，请充值后重试。正在尝试备选翻译方法...`);
                
                break;
              }
              
              // 连接错误增加更长延迟
              const delay = retryError.message.includes("ECONNRESET") ? 
                5000 * retryCount : 2000 * retryCount;
              
              // 更新任务状态，提醒用户网络问题
              updateTaskStatus(taskId, "translating", Math.floor((i / paragraphs.length) * 100),
                `网络连接错误，正在第${retryCount}次重试...`);
              
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          }
          
          // 如果重试后仍然失败，使用备选API
          if (!translationSuccess) {
            console.log("主要翻译API失败，尝试使用备选翻译方法...");
            try {
              translatedParagraph = await translateWithGoogle(paragraph);
              translationSuccess = true;
              
              // 更新用户，告知已切换到Google翻译
              updateTaskStatus(taskId, "translating", Math.floor((i / paragraphs.length) * 100),
                `主要API失败，已切换到Google翻译。正在翻译段落 ${i+1}/${paragraphs.length}...`);
              
            } catch (googleError) {
              console.error(`Google翻译也失败:`, googleError.message);
              
              // 所有API都失败，使用模拟翻译
              const { simulateTranslation } = require('./converter');
              translatedParagraph = simulateTranslation(paragraph);
              translationSuccess = true;
              
              // 更新任务状态，告知用户已降级到模拟翻译
              updateTaskStatus(taskId, "translating", Math.floor((i / paragraphs.length) * 100),
                `所有翻译API都失败，已使用离线模拟翻译。翻译质量可能降低。`);
              
              console.log("所有API都失败，使用模拟翻译");
              
              // 增加错误计数
              translationErrorCount++;
              
              // 如果错误过多，提示用户
              if (translationErrorCount >= maxErrors) {
                updateTaskStatus(taskId, "translating", Math.floor((i / paragraphs.length) * 100),
                  `翻译过程中遇到多次错误 (${translationErrorCount}/${maxErrors})。请检查网络或API账户状态。`);
              }
            }
          }
        } catch (apiError) {
          console.error(`使用所有翻译API失败:`, apiError.message);
          
          // 直接使用模拟翻译作为最后手段
          const { simulateTranslation } = require('./converter');
          translatedParagraph = simulateTranslation(paragraph);
          translationSuccess = true;
          
          // 通知用户使用了模拟翻译
          updateTaskStatus(taskId, "translating", Math.floor((i / paragraphs.length) * 100),
            `翻译API出现意外错误，使用离线模拟翻译。翻译质量可能降低。`);
          
          console.log("发生意外错误，使用模拟翻译");
          
          // 增加错误计数
          translationErrorCount++;
        }
        
        // 只有在翻译成功的情况下，才添加到章节内容和保存到文件
        if (translationSuccess) {
          // 添加到章节内容和总翻译内容
          chapterContents.push(translatedParagraph);
          translatedParagraphs.push(translatedParagraph);
          paragraphsInCurrentSegment++;
          
          // 保存当前段落到临时文件
          const segmentFile = path.join(tempDir, `segment_${String(i+1).padStart(3, '0')}.txt`);
          await fs.writeFile(segmentFile, translatedParagraph, 'utf8');
          console.log(`已保存段落片段 ${i+1} 到 ${segmentFile}`);
        } else {
          // 翻译失败，记录错误，但不保存到文件
          console.error(`段落 ${i+1} 翻译失败，跳过此段落`);
          
          // 更新任务状态
          updateTaskStatus(taskId, "translating", Math.floor((i / paragraphs.length) * 100),
            `段落 ${i+1} 翻译失败，已跳过。请稍后重试或联系管理员。`);
          
          // 为保持段落序号连续，添加一个翻译失败的占位符
          const failureNote = `[翻译失败] 此段落翻译过程中出现错误，请稍后重试或联系管理员。\n原文: ${paragraphs[i].substring(0, 100)}...`;
          chapterContents.push(failureNote);
          translatedParagraphs.push(failureNote);
          paragraphsInCurrentSegment++;
          
          // 增加错误计数
          translationErrorCount++;
        }
        
        // 添加延迟，避免API请求过快被限流
        await new Promise(resolve => setTimeout(resolve, 2000));
        
      } catch (error) {
        console.error(`翻译段落 ${i+1} 失败:`, error);
        
        // 对于失败的部分，保留原文但不写入文件
        const failureNote = `[翻译失败] ${paragraphs[i]}`;
        chapterContents.push(failureNote);
        translatedParagraphs.push(failureNote);
        paragraphsInCurrentSegment++;
        
        // 更新任务状态
        updateTaskStatus(taskId, "translating", Math.floor((i / paragraphs.length) * 100),
          `段落 ${i+1} 翻译过程中出现意外错误，已跳过。请稍后重试。`);
        
        // 增加错误计数
        translationErrorCount++;
        
        // 如果错误过多，提示用户是否要取消任务
        if (translationErrorCount >= maxErrors) {
          updateTaskStatus(taskId, "translating", Math.floor((i / paragraphs.length) * 100),
            `翻译过程中遇到多次错误 (${translationErrorCount}/${maxErrors})。如需取消任务，请点击"取消"按钮。`);
        }
      }
    }
    
    // 保存最后一个章节或段落段
    if (chapterContents.length > 0) {
      if (hasRecognizedChapters) {
        // 保存为章节
        const chapterFilename = `${taskId}_chapter_${currentChapter.toString().padStart(3, '0')}.txt`;
        const chapterFilePath = path.join(chapterDir, chapterFilename);
        
        let chapterContent = `======== 《${outputBasename}》- ${chapterTitle} ========\n\n`;
        chapterContent += chapterContents.join('\n\n');
        
        await fs.writeFile(chapterFilePath, chapterContent);
        console.log(`已保存章节 ${currentChapter}: ${chapterTitle} 到 ${chapterFilePath}`);
        
        chapterFiles.push({
          number: currentChapter,
          title: chapterTitle,
          path: chapterFilePath,
          filename: path.basename(chapterFilePath)
        });
      } else {
        // 保存为段落段
        segmentNumber++;
        const segmentFilename = `${taskId}_segment_${segmentNumber.toString().padStart(3, '0')}.txt`;
        const segmentFilePath = path.join(chapterDir, segmentFilename);
        
        let segmentContent = `======== 《${outputBasename}》- 段落片段 ${segmentNumber} ========\n\n`;
        segmentContent += chapterContents.join('\n\n');
        
        await fs.writeFile(segmentFilePath, segmentContent);
        console.log(`已保存段落片段 ${segmentNumber} 到 ${segmentFilePath}`);
        
        chapterFiles.push({
          number: segmentNumber,
          title: `段落片段 ${segmentNumber}`,
          path: segmentFilePath,
          filename: path.basename(segmentFilePath)
        });
      }
      
      // 更新任务的章节列表
      tasks[taskId].chapterFiles = chapterFiles.map(ch => ({
        number: ch.number,
        title: ch.title,
        filename: ch.path ? path.basename(ch.path) : `chapter_${ch.number}.txt`
      }));
    }
    
    // 所有段落处理完成后，合并并保存完整翻译结果
    try {
      // 确保输出目录存在
      await fs.ensureDir(OUTPUT_DIR);
      
      // 读取并合并所有段落文件
      const segmentFiles = await fs.readdir(tempDir);
      const sortedFiles = segmentFiles
        .filter(f => f.startsWith('segment_'))
        .sort((a, b) => {
          const numA = parseInt(a.match(/segment_(\d+)/)[1]);
          const numB = parseInt(b.match(/segment_(\d+)/)[1]);
          return numA - numB;
        });
      
      let fullTranslation = `《${outputBasename}》\n\n`;
      
      for (const file of sortedFiles) {
        const content = await fs.readFile(path.join(tempDir, file), 'utf8');
        fullTranslation += content + '\n\n';
      }
      
      // 保存完整翻译文件
      await fs.writeFile(translationPath, fullTranslation);
      console.log(`已保存完整翻译到: ${translationPath}`);
      
      // 清理临时文件
      await fs.remove(tempDir);
      console.log(`已清理临时文件目录: ${tempDir}`);
      
      // 更新任务状态
      tasks[taskId].status = 'completed';
      tasks[taskId].progress = 100;
      tasks[taskId].message = '翻译已完成!';
      
      // 存储结果信息
      const downloadPath = `/outputs/${path.basename(translationPath)}`;
      tasks[taskId].result = {
        translationPath: translationPath,
        translationUrl: downloadPath
      };
      
      return translationPath;
    } catch (error) {
      console.error('保存完整翻译文件时出错:', error);
      throw error;
    }
  } catch (error) {
    console.error('处理PDF翻译任务时出错:', error);
    throw error;
  }
}

/**
 * 恢复翻译任务
 * @param {string} taskId - 任务ID
 * @param {string} pdfPath - 新上传的PDF文件路径
 */
async function resumeTranslationTask(taskId, pdfPath) {
  try {
    const task = tasks[taskId];
    if (!task) {
      throw new Error('任务不存在');
    }
    
    // 更新任务状态
    task.status = 'translating';
    task.pdfPath = pdfPath;
    task.completed = false;
    task.isRestored = true; // 标记为恢复的任务
    
    // 获取已翻译的段落数
    const lastProcessedSegment = task.lastProcessedSegment || 0;
    console.log(`恢复任务 ${taskId} 的翻译，从段落 ${lastProcessedSegment + 1} 开始`);
    
    // 重新开始翻译
    processTranslatePdfTask(taskId, pdfPath, path.join(OUTPUT_DIR, taskId), task.originalFilename || path.basename(pdfPath))
      .catch(err => {
        console.error('恢复翻译过程出错:', err);
        task.status = 'error';
        task.error = err.message;
        task.message = '恢复翻译失败: ' + err.message;
      });
    
    return { success: true, message: '翻译任务已恢复，将从上次中断处继续' };
  } catch (error) {
    console.error('恢复翻译任务失败:', error);
    return { success: false, message: error.message };
  }
} 