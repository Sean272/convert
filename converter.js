/**
 * EPUB转PDF转换模块
 * 提供将EPUB转换为PDF的核心功能
 */

const fs = require('fs-extra');
const path = require('path');
const EPub = require('epub');
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const AdmZip = require('adm-zip');
const xml2js = require('xml2js');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const { translate } = require('@vitalets/google-translate-api');
const fetch = require('node-fetch');
require('dotenv').config();

// 从环境变量中读取翻译相关配置
const MAX_TRANSLATE_LENGTH = parseInt(process.env.MAX_TRANSLATE_LENGTH || 3000); // 降低每次翻译的最大字符数
const TRANSLATE_DELAY = parseInt(process.env.TRANSLATE_DELAY || 3000); // 翻译请求间隔提高到3秒
const MAX_RETRY_ATTEMPTS = parseInt(process.env.MAX_RETRY_ATTEMPTS || 5); // 最大重试次数
const RETRY_DELAY_BASE = parseInt(process.env.RETRY_DELAY_BASE || 5000); // 重试基本延迟5秒

// API配置
const TRANSLATOR_API = process.env.TRANSLATOR_API || 'SIMULATE'; // 默认使用模拟翻译
const SILICONFLOW_API_KEY = process.env.SILICONFLOW_API_KEY;
const SILICONFLOW_API_URL = process.env.SILICONFLOW_API_URL || 'https://api.siliconflow.cn/v1/chat/completions';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_API_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions';

/**
 * 使用硅基流动API翻译文本到中文
 * @param {string} text - 待翻译文本
 * @returns {Promise<string>} - 翻译后的文本
 */
async function translateWithSiliconFlow(text) {
  if (!text || text.trim() === '') {
    return text;
  }

  if (!SILICONFLOW_API_KEY) {
    throw new Error('硅基流动API密钥未配置，请在.env文件中设置SILICONFLOW_API_KEY');
  }

  try {
    console.log(`使用硅基流动API翻译: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`);
    
    const response = await fetch(SILICONFLOW_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SILICONFLOW_API_KEY}`
      },
      body: JSON.stringify({
        model: "deepseek-ai/DeepSeek-V3", // 使用V3模型进行翻译，性价比更高
        messages: [
          { 
            role: "system", 
            content: "你是一个专业的翻译助手，请将提供的英文内容翻译成流畅自然的中文。只返回翻译结果，不要添加任何解释或额外内容。" 
          },
          { 
            role: "user", 
            content: text 
          }
        ],
        temperature: 0.3,
        max_tokens: 4000
      })
    });

    if (!response.ok) {
      // 详细记录错误信息
      const responseText = await response.text();
      console.error(`硅基流动API错误状态码: ${response.status}, 响应内容: ${responseText}`);
      
      try {
        const errorData = JSON.parse(responseText);
        throw new Error(`硅基流动API调用失败: ${errorData.error?.message || response.statusText || '未知错误'}`);
      } catch (jsonError) {
        throw new Error(`硅基流动API调用失败: ${response.statusText}, 响应: ${responseText}`);
      }
    }

    const data = await response.json();
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      throw new Error(`硅基流动API返回数据格式不正确: ${JSON.stringify(data)}`);
    }
    
    const translatedText = data.choices[0].message.content.trim();
    console.log(`硅基流动翻译成功，翻译了${text.length}个字符`);
    return translatedText;
  } catch (error) {
    console.error(`硅基流动翻译失败: ${error.message}`);
    throw error;
  }
}

/**
 * 使用DeepSeek官方API翻译文本到中文
 * @param {string} text - 待翻译文本
 * @returns {Promise<string>} - 翻译后的文本
 */
async function translateWithDeepSeek(text) {
  if (!text || text.trim() === '') {
    return text;
  }

  if (!DEEPSEEK_API_KEY) {
    throw new Error('DeepSeek API密钥未配置，请在.env文件中设置DEEPSEEK_API_KEY');
  }

  try {
    console.log(`使用DeepSeek官方API翻译: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`);
    
    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { 
            role: "system", 
            content: "你是一个专业的翻译助手，请将提供的英文内容翻译成流畅自然的中文。只返回翻译结果，不要添加任何解释或额外内容。" 
          },
          { 
            role: "user", 
            content: text 
          }
        ],
        temperature: 0.3,
        max_tokens: 4000
      })
    });

    if (!response.ok) {
      const responseText = await response.text();
      console.error(`DeepSeek API错误状态码: ${response.status}, 响应内容: ${responseText}`);
      
      try {
        const errorData = JSON.parse(responseText);
        throw new Error(`DeepSeek API调用失败: ${errorData.error?.message || response.statusText || '未知错误'}`);
      } catch (jsonError) {
        throw new Error(`DeepSeek API调用失败: ${response.statusText}, 响应: ${responseText}`);
      }
    }

    const data = await response.json();
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      throw new Error(`DeepSeek API返回数据格式不正确: ${JSON.stringify(data)}`);
    }
    
    const translatedText = data.choices[0].message.content.trim();
    console.log(`DeepSeek翻译成功，翻译了${text.length}个字符`);
    return translatedText;
  } catch (error) {
    console.error(`DeepSeek翻译失败: ${error.message}`);
    throw error;
  }
}

/**
 * 使用Google翻译API翻译文本到中文
 * @param {string} text - 待翻译文本
 * @returns {Promise<string>} - 翻译后的文本
 */
async function translateWithGoogle(text) {
  if (!text || text.trim() === '') {
    return text;
  }

  try {
    console.log(`使用Google翻译API: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`);
    const { text: translatedText } = await translate(text, { to: 'zh-CN' });
    console.log(`Google翻译成功，翻译了 ${text.length} 个字符`);
    return translatedText;
  } catch (error) {
    console.error(`Google翻译失败: ${error.message}`);
    throw error;
  }
}

/**
 * 将文本翻译为中文，根据配置选择翻译API
 * @param {string} text - 待翻译文本
 * @param {number} retryCount - 当前重试次数
 * @returns {Promise<string>} - 翻译后的文本
 */
async function translateText(text, retryCount = 0) {
  if (!text || text.trim() === '') {
    return text;
  }

  // 加入模拟翻译的功能，当重试次数过多时自动启用
  if (retryCount >= 2) {
    console.log(`已达到重试阈值，使用简单替换的模拟翻译`);
    return simulateTranslation(text);
  }
  
  try {
    // 翻译API可能有长度限制，分段翻译
    if (text.length > MAX_TRANSLATE_LENGTH) {
      console.log(`文本长度超过${MAX_TRANSLATE_LENGTH}，进行分段翻译`);
      
      // 按句子分割文本（更智能的分割）
      const sentences = text.split(/(?<=[.!?。！？])\s+/);
      let result = '';
      let currentBatch = '';
      
      for (const sentence of sentences) {
        // 如果当前批次加上新句子超过限制，先翻译当前批次
        if (currentBatch.length + sentence.length > MAX_TRANSLATE_LENGTH) {
          if (currentBatch.length > 0) {
            const translated = await translateText(currentBatch);
            result += translated;
            currentBatch = '';
            
            // 增加随机延迟，避免过快请求API
            const randomDelay = TRANSLATE_DELAY + Math.floor(Math.random() * 2000);
            console.log(`添加随机延迟 ${randomDelay}ms 避免请求过快`);
            await new Promise(resolve => setTimeout(resolve, randomDelay));
          }
        }
        
        currentBatch += sentence + ' ';
      }
      
      // 翻译最后一批
      if (currentBatch.length > 0) {
        const translated = await translateText(currentBatch);
        result += translated;
      }
      
      return result;
    }
    
    // 根据配置选择翻译API
    try {
      switch (TRANSLATOR_API.toUpperCase()) {
        case 'SILICONFLOW':
          console.log(`使用硅基流动API翻译...`);
          return await translateWithSiliconFlow(text);
        
        case 'DEEPSEEK':
          console.log(`使用DeepSeek官方API翻译...`);
          return await translateWithDeepSeek(text);
          
        case 'GOOGLE':
          console.log(`使用Google翻译API...`);
          return await translateWithGoogle(text);
          
        case 'SIMULATE':
          console.log(`使用模拟翻译...`);
          return simulateTranslation(text);
          
        default:
          // 默认使用模拟翻译，避免API费用
          console.log(`未指定有效的翻译API，使用模拟翻译...`);
          return simulateTranslation(text);
      }
    } catch (apiError) {
      // 记录具体错误
      console.warn(`翻译API调用失败: ${apiError.message}`);
      
      // 直接使用模拟翻译作为备选
      console.log(`使用模拟翻译作为备选方案`);
      return simulateTranslation(text);
    }
  } catch (error) {
    console.error(`翻译失败: ${error.message}`);
    
    // 如果是请求限制错误，进行重试
    if ((error.message.includes('Too Many Requests') || error.message.includes('429')) 
        && retryCount < MAX_RETRY_ATTEMPTS) {
      const retryDelay = RETRY_DELAY_BASE * Math.pow(2, retryCount); // 指数退避
      console.log(`遇到请求限制，${retryDelay}ms 后第 ${retryCount + 1} 次重试...`);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
      return translateText(text, retryCount + 1);
    }
    
    // 达到最大重试次数或其他错误，使用模拟翻译
    console.warn(`达到最大重试次数或遇到其他错误，使用模拟翻译`);
    return simulateTranslation(text);
  }
}

/**
 * 简单的模拟翻译，返回双语内容以保留原文
 * @param {string} text - 原始文本
 * @returns {string} - 模拟翻译的文本
 */
function simulateTranslation(text) {
  // 常见英文单词和短语的简单中文对应(扩展词典)
  const simpleDictionary = {
    // 基础词汇
    'the': '这个',
    'a': '一个',
    'an': '一个',
    'and': '和',
    'is': '是',
    'are': '是',
    'in': '在',
    'to': '到',
    'of': '的',
    'for': '为了',
    'with': '与',
    'by': '通过',
    'on': '在...上',
    'at': '在',
    'from': '从',
    'as': '作为',
    'or': '或者',
    'not': '不',
    'but': '但是',
    'it': '它',
    'they': '他们',
    'we': '我们',
    'you': '你',
    'he': '他',
    'she': '她',
    'this': '这个',
    'that': '那个',
    'these': '这些',
    'those': '那些',
    'there': '那里',
    'here': '这里',
    'when': '当',
    'where': '哪里',
    'why': '为什么',
    'how': '如何',
    'what': '什么',
    'who': '谁',
    'which': '哪个',
    'will': '将会',
    'would': '会',
    'could': '可能会',
    'should': '应该',
    'can': '能够',
    'may': '可能',
    'might': '可能',
    'must': '必须',
    'have': '有',
    'has': '有',
    'had': '有',
    'do': '做',
    'does': '做',
    'did': '做',
    'been': '曾是',
    'being': '正在',
    'be': '是',
    'was': '是',
    'were': '是',
    'more': '更多',
    'most': '最多',
    'some': '一些',
    'any': '任何',
    'no': '没有',
    'all': '所有',
    'many': '许多',
    'much': '很多',
    'few': '几个',
    'little': '一点',
    'other': '其他',
    'another': '另一个',
    'such': '这样的',
    'so': '如此',
    'than': '比',
    'then': '然后',
    'thus': '因此',
    'though': '虽然',
    'although': '尽管',
    'if': '如果',
    'unless': '除非',
    'while': '当...时',
    'because': '因为',
    'since': '自从',
    'until': '直到',
    'after': '之后',
    'before': '之前',
    'during': '期间',
    'under': '在...下',
    'over': '超过',
    'through': '通过',
    'throughout': '遍及',
    'between': '之间',
    'among': '在...之中',
    'within': '在...之内',
    'without': '没有',
    'about': '关于',
    'against': '反对',
    'around': '围绕',
    'beyond': '超出',
    'across': '穿过',
    'along': '沿着',
    'upon': '在...之上',
    'next': '下一个',
    'previous': '前一个',
    'last': '最后',
    'first': '第一',
    'second': '第二',
    'third': '第三',
    
    // 学术文章常用词汇
    'introduction': '介绍',
    'chapter': '章节',
    'section': '部分',
    'book': '书',
    'page': '页面',
    'example': '示例',
    'content': '内容',
    'reference': '参考',
    'author': '作者',
    'title': '标题',
    'figure': '图',
    'table': '表',
    'image': '图像',
    'note': '注释',
    'summary': '总结',
    'conclusion': '结论',
    'information': '信息',
    'data': '数据',
    'research': '研究',
    'analysis': '分析',
    'theory': '理论',
    'method': '方法',
    'process': '过程',
    'result': '结果',
    'discussion': '讨论',
    'study': '研究',
    'experiment': '实验',
    'observation': '观察',
    'measurement': '测量',
    'calculation': '计算',
    'evidence': '证据',
    'argument': '论点',
    'hypothesis': '假设',
    'conclusion': '结论',
    'findings': '发现',
    'abstract': '摘要',
    'publication': '出版物',
    'journal': '期刊',
    'article': '文章',
    'citation': '引用',
    'bibliography': '参考文献',
    'appendix': '附录',
    'footnote': '脚注',
    'glossary': '术语表',
    'preface': '前言',
    'foreword': '序言',
    'acknowledgment': '致谢',
    'index': '索引',
    
    // 科技相关
    'computer': '计算机',
    'software': '软件',
    'hardware': '硬件',
    'program': '程序',
    'system': '系统',
    'network': '网络',
    'internet': '互联网',
    'technology': '技术',
    'device': '设备',
    'application': '应用',
    'code': '代码',
    'file': '文件',
    'memory': '内存',
    'storage': '存储',
    'processor': '处理器',
    'algorithm': '算法',
    'database': '数据库',
    'user': '用户',
    'interface': '界面',
    'digital': '数字的',
    'electronic': '电子的',
    'intelligence': '智能',
    'artificial': '人工的',
    
    // 场景相关
    'time': '时间',
    'year': '年',
    'month': '月',
    'day': '日',
    'hour': '小时',
    'minute': '分钟',
    'second': '秒',
    'today': '今天',
    'tomorrow': '明天',
    'yesterday': '昨天',
    'world': '世界',
    'country': '国家',
    'city': '城市',
    'place': '地方',
    'home': '家',
    'office': '办公室',
    'building': '建筑',
    'room': '房间',
    'door': '门',
    'window': '窗户',
    'wall': '墙',
    'floor': '地板',
    'ceiling': '天花板',
    'road': '道路',
    'street': '街道',
    'path': '路径',
    'car': '汽车',
    'train': '火车',
    'plane': '飞机',
    'boat': '船',
    'bus': '公交车',
    'bike': '自行车',
    'walk': '走路',
    'run': '跑步',
    'food': '食物',
    'water': '水',
    'air': '空气',
    'light': '光',
    'fire': '火',
    'earth': '地球',
    'sun': '太阳',
    'moon': '月亮',
    'star': '星星',
    'sky': '天空'
  };
  
  // 创建简单的替换
  let translatedText = text;
  for (const [eng, chi] of Object.entries(simpleDictionary)) {
    // 仅替换单词边界的完整单词，保持大小写
    const regExpLower = new RegExp(`\\b${eng}\\b`, 'g');
    const regExpCap = new RegExp(`\\b${eng.charAt(0).toUpperCase() + eng.slice(1)}\\b`, 'g');
    
    // 替换小写版本
    translatedText = translatedText.replace(regExpLower, `${chi}`);
    
    // 替换首字母大写版本
    translatedText = translatedText.replace(regExpCap, `${chi.charAt(0).toUpperCase() + chi.slice(1)}`);
  }
  
  // 返回双语格式
  return `${translatedText}\n【原文】${text}`;
}

/**
 * 翻译HTML内容
 * @param {string} html - HTML内容
 * @returns {Promise<string>} - 翻译后的HTML
 */
async function translateHtml(html) {
  try {
    const $ = cheerio.load(html);
    console.log('开始翻译HTML内容...');
    
    // 翻译标题
    const title = $('title').text();
    if (title) {
      console.log(`翻译标题: ${title.substring(0, 30)}...`);
      const translatedTitle = await translateText(title);
      $('title').text(translatedTitle);
      
      // 标题翻译后添加额外延迟
      await new Promise(resolve => setTimeout(resolve, TRANSLATE_DELAY));
    }
    
    // 先计算需要翻译的段落数量
    const paragraphs = $('p');
    console.log(`需要翻译 ${paragraphs.length} 个段落`);
    
    // 分批翻译段落，每批10个段落
    const BATCH_SIZE = 5; // 减小批量大小
    
    for (let i = 0; i < paragraphs.length; i += BATCH_SIZE) {
      console.log(`翻译段落批次 ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(paragraphs.length/BATCH_SIZE)}`);
      
      // 每批次间额外延迟
      if (i > 0) {
        const batchDelay = TRANSLATE_DELAY * 2;
        console.log(`批次间等待 ${batchDelay}ms...`);
        await new Promise(resolve => setTimeout(resolve, batchDelay));
      }
      
      // 处理当前批次
      const end = Math.min(i + BATCH_SIZE, paragraphs.length);
      for (let j = i; j < end; j++) {
        const p = paragraphs.eq(j);
        const text = p.text();
        
        if (text && text.trim() !== '') {
          try {
            // 只记录较短的文本片段
            const logText = text.length > 50 ? text.substring(0, 50) + '...' : text;
            console.log(`翻译段落 ${j+1}/${paragraphs.length}: ${logText}`);
            
            const translatedText = await translateText(text);
            p.text(translatedText);
            
            // 每个段落之间添加随机延迟
            const randomDelay = TRANSLATE_DELAY + Math.floor(Math.random() * 1000);
            await new Promise(resolve => setTimeout(resolve, randomDelay));
          } catch (pError) {
            console.error(`翻译段落失败: ${pError.message}`);
            // 继续处理下一个段落
            continue;
          }
        }
      }
    }
    
    // 翻译标题元素（h1-h6）
    const headings = $('h1, h2, h3, h4, h5, h6');
    console.log(`需要翻译 ${headings.length} 个标题元素`);
    
    for (let i = 0; i < headings.length; i++) {
      const h = headings.eq(i);
      const text = h.text();
      
      if (text && text.trim() !== '') {
        try {
          console.log(`翻译标题元素 ${i+1}/${headings.length}: ${text.substring(0, 30)}...`);
          const translatedText = await translateText(text);
          h.text(translatedText);
          
          // 每个标题后添加延迟
          await new Promise(resolve => setTimeout(resolve, TRANSLATE_DELAY));
        } catch (hError) {
          console.error(`翻译标题元素失败: ${hError.message}`);
          continue;
        }
      }
    }
    
    console.log('HTML内容翻译完成');
    return $.html();
  } catch (error) {
    console.error(`HTML翻译失败: ${error.message}`);
    // 失败时返回原HTML
    return html;
  }
}

/**
 * 预处理EPUB文件，以解决可能的格式问题
 * @param {string} epubPath - 原始EPUB文件路径
 * @param {string} tempDir - 临时目录路径
 * @returns {Promise<string>} - 处理后的EPUB文件路径
 */
async function preprocessEpub(epubPath, tempDir) {
  try {
    console.log(`开始预处理EPUB文件: ${epubPath}`);
    
    // 检查文件是否存在
    if (!fs.existsSync(epubPath)) {
      throw new Error(`EPUB文件不存在: ${epubPath}`);
    }
    
    // 创建预处理的输出路径
    const preprocessedPath = path.join(tempDir, 'preprocessed.epub');
    
    // 简单复制文件 - 如果需要可以在这里添加更复杂的处理
    await fs.copy(epubPath, preprocessedPath);
    
    // 验证EPUB文件
    const stats = await fs.stat(preprocessedPath);
    if (stats.size < 100) { // 如果文件太小，很可能不是有效的EPUB
      throw new Error('EPUB文件不完整或格式无效');
    }
    
    console.log(`EPUB预处理完成: ${preprocessedPath}`);
    return preprocessedPath;
  } catch (error) {
    console.error(`EPUB预处理失败: ${error.message}`);
    throw error;
  }
}

/**
 * 解析EPUB文件
 * @param {string} epubPath - EPUB文件路径
 * @param {string} tempDir - 临时目录
 * @param {Function} progressCallback - 进度回调
 * @returns {Promise<Object>} - 解析结果
 */
async function parseEpub(epubPath, tempDir, progressCallback = null) {
  try {
    console.log(`开始解析EPUB文件: ${epubPath}`);
    if (typeof progressCallback === 'function') progressCallback(0.1, '开始解析EPUB文件');
    
    // 先尝试使用直接提取方法
    try {
      console.log('尝试直接解析EPUB文件...');
      const directResult = await extractEpubDirectly(epubPath, tempDir);
      
      if (directResult.htmlFiles && directResult.htmlFiles.length > 0) {
        console.log(`直接提取成功: 找到 ${directResult.htmlFiles.length} 个HTML文件`);
        if (typeof progressCallback === 'function') progressCallback(0.3, `找到 ${directResult.htmlFiles.length} 个HTML内容`);
        return directResult;
      } else {
        console.log('直接提取未找到HTML内容，尝试使用epub库...');
      }
    } catch (directError) {
      console.warn(`直接提取失败: ${directError.message}`);
    }
    
    // 如果直接提取失败，使用epub库
    if (typeof progressCallback === 'function') progressCallback(0.15, '尝试使用epub库解析');
    
    const epubContent = {
      htmlFiles: [],
      cssFiles: [],
      imageFiles: [],
      tocItems: []
    };
    
    try {
      // 使用epub库解析
      console.log('使用epub库解析...');
      const book = new EPub(epubPath);
      
      // 解析epub
      await new Promise((resolve, reject) => {
        book.parse();
        
        book.on('end', () => {
          console.log('epub库解析完成');
          resolve();
        });
        
        book.on('error', err => {
          console.error('epub库解析失败:', err);
          reject(err);
        });
      });
      
      if (typeof progressCallback === 'function') progressCallback(0.2, 'epub库解析完成，提取章节内容');
      
      // 获取章节
      console.log(`epub库找到 ${book.flow.length} 个内容项`);
      
      // 准备提取内容
      const chapters = [];
      
      for (let i = 0; i < book.flow.length; i++) {
        const item = book.flow[i];
        
        try {
          const content = await getChapterContent(book, item.id);
          if (content) {
            console.log(`成功提取第 ${i+1} 项内容`);
            chapters.push({
              id: item.id,
              href: item.href,
              content: content
            });
          } else {
            console.warn(`警告：第 ${i+1} 项内容为空，已跳过`);
          }
        } catch (chapterError) {
          console.warn(`提取第 ${i+1} 项内容失败: ${chapterError.message}`);
        }
      }
      
      if (typeof progressCallback === 'function') progressCallback(0.25, `提取了 ${chapters.length} 个章节内容`);
      
      // 将提取的内容保存为HTML文件
      console.log(`保存 ${chapters.length} 个章节内容到临时目录...`);
      
      for (let i = 0; i < chapters.length; i++) {
        const chapter = chapters[i];
        const outputPath = path.join(tempDir, `chapter_${i}.html`);
        
        await fs.writeFile(outputPath, chapter.content);
        
        epubContent.htmlFiles.push({
          id: chapter.id,
          path: outputPath,
          href: chapter.href
        });
      }
      
      // 提取资源文件
      console.log('提取CSS和图片资源...');
      
      // 处理CSS
      if (book.stylesheet && book.stylesheet.content) {
        for (const id in book.stylesheet.content) {
          try {
            const content = book.stylesheet.content[id];
            const outputPath = path.join(tempDir, `style_${id}.css`);
            await fs.writeFile(outputPath, content);
            
            epubContent.cssFiles.push({
              id: id,
              path: outputPath,
              href: book.stylesheet.href[id]
            });
          } catch (cssError) {
            console.warn(`提取CSS失败 (${id}): ${cssError.message}`);
          }
        }
      }
      
      // 处理图片
      if (book.images && book.images.length > 0) {
        for (let i = 0; i < book.images.length; i++) {
          try {
            const image = book.images[i];
            const content = await getResourceContent(book, image);
            
            if (content) {
              const outputPath = path.join(tempDir, `image_${i}${path.extname(image)}`);
              await fs.writeFile(outputPath, content);
              
              epubContent.imageFiles.push({
                id: `image_${i}`,
                path: outputPath,
                href: image
              });
            }
          } catch (imageError) {
            console.warn(`提取图片失败 (${book.images[i]}): ${imageError.message}`);
          }
        }
      }
      
      // 提取目录
      if (book.toc && book.toc.length > 0) {
        for (let i = 0; i < book.toc.length; i++) {
          const tocItem = book.toc[i];
          epubContent.tocItems.push({
            title: tocItem.title,
            href: tocItem.href
          });
        }
      } else {
        // 如果没有目录，创建简单目录
        for (let i = 0; i < epubContent.htmlFiles.length; i++) {
          epubContent.tocItems.push({
            title: `章节 ${i + 1}`,
            href: epubContent.htmlFiles[i].href
          });
        }
      }
      
      console.log(`epub库解析完成: 提取了 ${epubContent.htmlFiles.length} 个HTML文件, ${epubContent.cssFiles.length} 个CSS文件, ${epubContent.imageFiles.length} 个图片文件`);
      if (typeof progressCallback === 'function') progressCallback(0.3, `提取了 ${epubContent.htmlFiles.length} 个HTML内容`);
      
      return epubContent;
    } catch (epubError) {
      console.error(`epub库解析失败: ${epubError.message}`);
      
      // 如果epub库也失败了，再次尝试直接解析
      console.log('epub库解析失败，尝试直接解析作为最后手段...');
      
      const lastResult = await extractEpubDirectly(epubPath, tempDir);
      
      if (lastResult.htmlFiles && lastResult.htmlFiles.length > 0) {
        console.log(`最终尝试成功: 找到 ${lastResult.htmlFiles.length} 个HTML文件`);
        if (typeof progressCallback === 'function') progressCallback(0.3, `找到 ${lastResult.htmlFiles.length} 个HTML内容`);
        return lastResult;
      }
      
      // 如果所有方法都失败了，抛出错误
      throw new Error('未能提取任何有效的HTML内容，请检查EPUB文件格式');
    }
  } catch (error) {
    console.error(`EPUB解析失败: ${error.message}`);
    throw error;
  }
}

/**
 * 将EPUB转换为PDF
 * @param {string} epubPath - EPUB文件路径
 * @param {string} outputPath - 输出PDF路径
 * @param {Function} progressCallback - 进度回调
 * @param {Object} options - 转换选项
 * @param {boolean} options.translate - 是否翻译内容
 * @returns {Promise<string>} - 输出PDF路径
 */
async function convertEpubToPdf(epubPath, outputPath, progressCallback = null, options = {}) {
  const tempDir = options.tempDir || path.join(os.tmpdir(), 'epub2pdf', uuidv4());
  let cleanupNeeded = !options.keepTemp;
  const shouldTranslate = options.translate === true;
  
  try {
    console.log(`开始转换EPUB到PDF: ${epubPath} -> ${outputPath}`);
    console.log(`翻译选项: ${shouldTranslate ? '启用' : '禁用'}`);
    if (typeof progressCallback === 'function') progressCallback(0, '开始转换');
    
    // 创建临时目录
    await fs.mkdir(tempDir, { recursive: true });
    console.log(`创建临时目录: ${tempDir}`);
    
    // 预处理EPUB文件
    await preprocessEpub(epubPath, tempDir);
    if (typeof progressCallback === 'function') progressCallback(0.05, 'EPUB文件预处理完成');
    
    // 解析EPUB文件
    const epubContent = await parseEpub(epubPath, tempDir, progressCallback);
    
    if (!epubContent || !epubContent.htmlFiles || epubContent.htmlFiles.length === 0) {
      throw new Error('未能提取任何有效的HTML内容，请检查EPUB文件格式');
    }
    
    console.log(`EPUB解析完成，提取了 ${epubContent.htmlFiles.length} 个HTML文件`);
    if (typeof progressCallback === 'function') progressCallback(0.4, '创建合并HTML文件');
    
    // 创建合并的HTML文件
    const consolidatedHtmlPath = await createConsolidatedHtml(epubContent, tempDir);
    console.log(`已创建合并HTML: ${consolidatedHtmlPath}`);
    if (typeof progressCallback === 'function') progressCallback(0.6, '合并HTML文件创建完成');
    
    // 根据选项判断是否需要翻译
    if (shouldTranslate) {
      if (typeof progressCallback === 'function') progressCallback(0.65, '开始翻译内容...');
      
      try {
        // 读取合并的HTML内容
        const htmlContent = await fs.readFile(consolidatedHtmlPath, 'utf-8');
        
        // 翻译HTML内容
        console.log(`开始翻译HTML内容...`);
        
        let translatedHtml;
        try {
          translatedHtml = await translateHtml(htmlContent);
          console.log(`HTML内容翻译成功`);
        } catch (translationError) {
          console.error(`翻译处理出错: ${translationError.message}`);
          
          // 如果翻译出错，尝试使用备用的简单翻译方法
          console.log(`尝试使用备用的简化翻译方法...`);
          translatedHtml = await fallbackTranslateHtml(htmlContent);
        }
        
        // 将翻译后的内容写回文件
        const translatedHtmlPath = path.join(tempDir, 'translated.html');
        await fs.writeFile(translatedHtmlPath, translatedHtml, 'utf-8');
        console.log(`已保存翻译后的HTML: ${translatedHtmlPath}`);
        
        if (typeof progressCallback === 'function') progressCallback(0.75, 'HTML翻译完成');
        
        // 转换翻译后的HTML为PDF
        await convertHtmlToPdf(translatedHtmlPath, outputPath, progressCallback);
      } catch (translationProcessError) {
        console.error(`翻译过程失败: ${translationProcessError.message}，将直接转换原始HTML`);
        // 如果翻译过程失败，转换原始HTML
        await convertHtmlToPdf(consolidatedHtmlPath, outputPath, progressCallback);
      }
    } else {
      // 直接转换原始HTML为PDF
      await convertHtmlToPdf(consolidatedHtmlPath, outputPath, progressCallback);
    }
    
    console.log(`PDF转换完成: ${outputPath}`);
    if (typeof progressCallback === 'function') progressCallback(1, '转换完成');
    
    cleanupNeeded = !options.keepTemp;
    return outputPath;
  } catch (error) {
    console.error(`EPUB到PDF转换失败: ${error.message}`);
    throw error;
  } finally {
    // 清理临时文件
    if (cleanupNeeded) {
      try {
        await fs.remove(tempDir);
        console.log(`已清理临时目录: ${tempDir}`);
      } catch (cleanupError) {
        console.warn(`清理临时目录失败: ${cleanupError.message}`);
      }
    }
  }
}

/**
 * 备用翻译方法 - 简化版，更少API调用
 * 仅翻译重要元素且避免频繁API请求
 * @param {string} html - HTML内容
 * @returns {Promise<string>} - 翻译后的HTML
 */
async function fallbackTranslateHtml(html) {
  try {
    const $ = cheerio.load(html);
    console.log('使用备用翻译方法处理HTML...');
    
    // 1. 只翻译标题和重要的标题元素
    const title = $('title').text();
    if (title) {
      console.log(`翻译标题: ${title.substring(0, 30)}...`);
      try {
        const translatedTitle = await translateText(title, 0);
        $('title').text(translatedTitle);
        // 添加10秒延迟
        await new Promise(resolve => setTimeout(resolve, 10000));
      } catch (titleError) {
        console.warn(`标题翻译失败: ${titleError.message}`);
      }
    }
    
    // 2. 标题元素，只处理h1和h2
    const mainHeadings = $('h1, h2').slice(0, 10); // 限制为前10个
    console.log(`选择性翻译 ${mainHeadings.length} 个主要标题元素`);
    
    for (let i = 0; i < mainHeadings.length; i++) {
      const h = mainHeadings.eq(i);
      const text = h.text();
      
      if (text && text.trim() !== '' && text.length < 200) { // 限制长度
        try {
          console.log(`翻译主标题 ${i+1}/${mainHeadings.length}: ${text}`);
          const translatedText = await translateText(text, 0);
          h.text(translatedText);
          
          // 每个标题添加较长延迟
          await new Promise(resolve => setTimeout(resolve, 10000));
        } catch (hError) {
          console.error(`标题翻译失败，跳过: ${hError.message}`);
          continue;
        }
      }
    }
    
    // 3. 段落：只翻译前100个字符超过30个的段落，每章节取样
    // 找到所有段落
    const paragraphs = $('p');
    const significantParagraphs = [];
    
    // 筛选重要段落（较长且不重复的）
    const processedTexts = new Set();
    for (let i = 0; i < paragraphs.length; i++) {
      const p = paragraphs.eq(i);
      const text = p.text().trim();
      
      // 只处理长度合适且不重复的段落
      if (text.length > 30 && text.length < 1000 && !processedTexts.has(text)) {
        significantParagraphs.push(p);
        processedTexts.add(text);
        
        // 限制总数，避免处理太多
        if (significantParagraphs.length >= 30) break;
      }
    }
    
    console.log(`选择了 ${significantParagraphs.length} 个关键段落进行翻译`);
    
    // 翻译这些重要段落
    for (let i = 0; i < significantParagraphs.length; i++) {
      const p = significantParagraphs[i];
      const text = p.text().trim();
      
      try {
        console.log(`翻译关键段落 ${i+1}/${significantParagraphs.length}: ${text.substring(0, 50)}...`);
        
        // 只翻译段落的前200个字符作为示例
        const sampleText = text.substring(0, 200);
        const translatedText = await translateText(sampleText, 0);
        
        // 将段落内容替换为翻译后内容+原文
        p.text(`${translatedText} (原文: ${text})`);
        
        // 添加长延迟
        await new Promise(resolve => setTimeout(resolve, 15000));
      } catch (pError) {
        console.error(`段落翻译失败: ${pError.message}`);
        continue;
      }
    }
    
    console.log('备用翻译方法完成，已翻译部分重要内容');
    return $.html();
  } catch (error) {
    console.error(`备用翻译失败: ${error.message}`);
    return html; // 失败返回原HTML
  }
}

/**
 * 直接从EPUB提取内容
 * @param {string} epubPath - EPUB文件路径
 * @param {string} tempDir - 临时目录
 * @returns {Promise<Object>} 提取的内容
 */
async function extractEpubDirectly(epubPath, tempDir) {
  try {
    console.log(`直接提取EPUB内容: ${epubPath}`);
    const extractDir = path.join(tempDir, 'extracted');
    
    // 确保提取目录存在
    await fs.mkdir(extractDir, { recursive: true });
    
    // 使用AdmZip提取EPUB文件
    const zip = new AdmZip(epubPath);
    zip.extractAllTo(extractDir, true);
    console.log(`EPUB已提取到: ${extractDir}`);
    
    // 首先尝试查找OPF文件
    console.log('尝试查找OPF文件...');
    const opfFiles = [];
    const opfFindResult = await findOpfFile(extractDir, opfFiles);
    
    if (opfFindResult && opfFiles.length > 0) {
      console.log(`找到OPF文件: ${opfFiles[0]}`);
      try {
        // 解析OPF文件获取内容信息
        const result = await parseOpfFile(opfFiles[0], extractDir);
        
        // 检查是否成功提取到内容
        if (result.htmlFiles.length > 0) {
          console.log(`从OPF成功提取了 ${result.htmlFiles.length} 个HTML文件`);
          
          // 尝试提取目录（TOC）
          const tocFile = path.join(path.dirname(opfFiles[0]), 'toc.ncx');
          if (fs.existsSync(tocFile)) {
            try {
              const tocItems = await parseTocFile(tocFile, extractDir);
              if (tocItems.length > 0) {
                console.log(`从toc.ncx提取了 ${tocItems.length} 个目录项`);
                result.tocItems = tocItems;
              }
            } catch (tocError) {
              console.warn(`解析目录文件失败: ${tocError.message}`);
            }
          }
          
          return result;
        } else {
          console.log('OPF文件没有提供HTML内容，尝试直接搜索...');
        }
      } catch (opfError) {
        console.warn(`解析OPF文件失败: ${opfError.message}`);
      }
    } else {
      console.log('未找到OPF文件，尝试直接搜索内容文件...');
    }
    
    // 如果OPF解析失败或未找到OPF文件，直接搜索内容文件
    return await findContentFilesDirectly(extractDir);
  } catch (error) {
    console.error(`直接提取EPUB内容失败: ${error.message}`);
    throw error;
  }
}

/**
 * 查找OPF文件
 * @param {string} dir - 要搜索的目录
 * @param {Array} opfFiles - 找到的OPF文件列表
 * @returns {Promise<boolean>} 是否找到OPF文件
 */
async function findOpfFile(dir, opfFiles) {
  try {
    // 常见的OPF文件位置
    const commonOpfPaths = [
      path.join(dir, 'content.opf'),
      path.join(dir, 'OEBPS', 'content.opf'),
      path.join(dir, 'OPS', 'content.opf'),
      path.join(dir, 'META-INF', 'container.xml')
    ];
    
    // 首先检查常见位置
    for (const opfPath of commonOpfPaths) {
      if (fs.existsSync(opfPath)) {
        // 如果是container.xml，解析它获取真正的OPF文件路径
        if (opfPath.endsWith('container.xml')) {
          try {
            const containerXml = await fs.readFile(opfPath, 'utf8');
            const parser = new xml2js.Parser();
            const result = await parser.parseStringPromise(containerXml);
            
            if (result && 
                result.container && 
                result.container.rootfiles && 
                result.container.rootfiles[0] && 
                result.container.rootfiles[0].rootfile) {
              
              const rootfile = result.container.rootfiles[0].rootfile[0];
              if (rootfile && rootfile.$['full-path']) {
                const realOpfPath = path.join(dir, rootfile.$['full-path']);
                if (fs.existsSync(realOpfPath)) {
                  opfFiles.push(realOpfPath);
                  return true;
                }
              }
            }
          } catch (error) {
            console.warn(`解析container.xml失败: ${error.message}`);
          }
        } else {
          opfFiles.push(opfPath);
          return true;
        }
      }
    }
    
    // 如果常见位置没有找到，递归搜索
    const findOpfRecursive = async (directory) => {
      try {
        const files = await fs.readdir(directory);
        
        for (const file of files) {
          const filePath = path.join(directory, file);
          const stats = await fs.stat(filePath);
          
          if (stats.isDirectory()) {
            const found = await findOpfRecursive(filePath);
            if (found) return true;
          } else if (file.endsWith('.opf')) {
            opfFiles.push(filePath);
            return true;
          }
        }
        
        return false;
      } catch (error) {
        console.warn(`搜索OPF文件失败 (${directory}): ${error.message}`);
        return false;
      }
    };
    
    return await findOpfRecursive(dir);
  } catch (error) {
    console.warn(`查找OPF文件失败: ${error.message}`);
    return false;
  }
}

/**
 * 解析OPF文件
 * @param {string} opfPath - OPF文件路径
 * @param {string} extractDir - 提取目录
 * @returns {Promise<Object>} 解析结果
 */
async function parseOpfFile(opfPath, extractDir) {
  try {
    console.log(`解析OPF文件: ${opfPath}`);
    const opfXml = await fs.readFile(opfPath, 'utf8');
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(opfXml);
    
    const htmlFiles = [];
    const cssFiles = [];
    const imageFiles = [];
    const opfDir = path.dirname(opfPath);
    
    if (result && result.package && result.package.manifest && result.package.manifest[0] && result.package.manifest[0].item) {
      const items = result.package.manifest[0].item;
      console.log(`OPF文件中找到 ${items.length} 个项目`);
      
      for (const item of items) {
        try {
          if (!item.$ || !item.$.href) {
            console.warn('跳过缺少href属性的项目');
            continue;
          }
          
          const href = item.$.href;
          const mediaType = item.$['media-type'] || '';
          const id = item.$.id || '';
          const filePath = path.join(opfDir, href);
          
          // 如果文件不存在，尝试URL解码路径
          let fileExists = fs.existsSync(filePath);
          let actualPath = filePath;
          
          if (!fileExists) {
            const decodedHref = decodeURIComponent(href);
            actualPath = path.join(opfDir, decodedHref);
            fileExists = fs.existsSync(actualPath);
          }
          
          if (!fileExists) {
            console.warn(`文件不存在: ${filePath}`);
            continue;
          }
          
          if (mediaType.includes('html') || mediaType.includes('xhtml') || href.match(/\.(html|xhtml|htm)$/i)) {
            console.log(`添加HTML文件: ${href}`);
            htmlFiles.push({
              id: id || `html_${htmlFiles.length}`,
              path: actualPath,
              href: href
            });
          } else if (mediaType.includes('css') || href.match(/\.css$/i)) {
            cssFiles.push({
              id: id || `css_${cssFiles.length}`,
              path: actualPath,
              href: href
            });
          } else if (mediaType.includes('image') || href.match(/\.(jpg|jpeg|png|gif|svg)$/i)) {
            imageFiles.push({
              id: id || `img_${imageFiles.length}`,
              path: actualPath,
              href: href
            });
          }
        } catch (itemError) {
          console.warn(`处理OPF项目失败: ${itemError.message}`);
        }
      }
    }
    
    // 获取阅读顺序
    let spine = [];
    if (result && result.package && result.package.spine && result.package.spine[0] && result.package.spine[0].itemref) {
      spine = result.package.spine[0].itemref.map(item => item.$.idref);
    }
    
    // 按照spine顺序排序HTML文件
    if (spine.length > 0 && htmlFiles.length > 0) {
      htmlFiles.sort((a, b) => {
        const indexA = spine.indexOf(a.id);
        const indexB = spine.indexOf(b.id);
        
        if (indexA !== -1 && indexB !== -1) {
          return indexA - indexB;
        } else if (indexA !== -1) {
          return -1;
        } else if (indexB !== -1) {
          return 1;
        } else {
          return 0;
        }
      });
    }
    
    // 创建临时目录结构（如果从OPF解析）
    let tocItems = [];
    if (htmlFiles.length > 0) {
      // 尝试从HTML文件中提取标题
      for (let i = 0; i < htmlFiles.length; i++) {
        try {
          if (fs.existsSync(htmlFiles[i].path)) {
            const content = await fs.readFile(htmlFiles[i].path, 'utf8');
            const $ = cheerio.load(content);
            const title = $('title').text() || 
                     $('h1').first().text() || 
                     $('h2').first().text() || 
                     `章节 ${i + 1}`;
            
            tocItems.push({
              title: title,
              href: htmlFiles[i].href
            });
          } else {
            tocItems.push({
              title: `章节 ${i + 1}`,
              href: htmlFiles[i].href
            });
          }
        } catch (error) {
          console.warn(`提取章节标题失败: ${error.message}`);
          tocItems.push({
            title: `章节 ${i + 1}`,
            href: htmlFiles[i].href
          });
        }
      }
    }
    
    return {
      htmlFiles,
      cssFiles,
      imageFiles,
      tocItems
    };
  } catch (error) {
    console.error(`解析OPF文件失败: ${error.message}`);
    return {
      htmlFiles: [],
      cssFiles: [],
      imageFiles: [],
      tocItems: []
    };
  }
}

/**
 * 解析目录文件
 * @param {string} tocPath - 目录文件路径
 * @param {string} extractDir - 提取目录
 * @returns {Promise<Array>} 目录项列表
 */
async function parseTocFile(tocPath, extractDir) {
  try {
    console.log(`解析目录文件: ${tocPath}`);
    const tocXml = await fs.readFile(tocPath, 'utf8');
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(tocXml);
    const tocItems = [];
    const tocDir = path.dirname(tocPath);
    
    if (result && result.ncx && result.ncx.navMap && result.ncx.navMap[0] && result.ncx.navMap[0].navPoint) {
      const processNavPoint = (navPoints) => {
        for (const navPoint of navPoints) {
          try {
            if (navPoint.navLabel && navPoint.navLabel[0] && navPoint.navLabel[0].text && navPoint.content && navPoint.content[0] && navPoint.content[0].$ && navPoint.content[0].$.src) {
              const title = navPoint.navLabel[0].text[0];
              const src = navPoint.content[0].$.src;
              
              tocItems.push({
                title: title,
                href: src
              });
            }
            
            if (navPoint.navPoint) {
              processNavPoint(navPoint.navPoint);
            }
          } catch (navPointError) {
            console.warn(`处理导航点失败: ${navPointError.message}`);
          }
        }
      };
      
      processNavPoint(result.ncx.navMap[0].navPoint);
    }
    
    return tocItems;
  } catch (error) {
    console.error(`解析目录文件失败: ${error.message}`);
    return [];
  }
}

/**
 * 直接查找内容文件
 * @param {string} dir - 要搜索的目录
 * @returns {Promise<Object>} - 内容文件列表
 */
async function findContentFilesDirectly(dir) {
  try {
    console.log(`直接搜索内容文件: ${dir}`);
    const htmlFiles = [];
    const cssFiles = [];
    const imageFiles = [];
    
    // 递归查找文件
    await findFiles(dir, htmlFiles, cssFiles, imageFiles, dir);
    
    console.log(`直接搜索完成: 找到 ${htmlFiles.length} 个HTML文件, ${cssFiles.length} 个CSS文件, ${imageFiles.length} 个图片文件`);
    
    // 如果没有找到HTML文件，进行额外尝试
    if (htmlFiles.length === 0) {
      console.log('尝试在特定目录中查找HTML文件...');
      
      // 常见的EPUB内容目录
      const commonContentDirs = [
        path.join(dir, 'OEBPS'),
        path.join(dir, 'OPS'),
        path.join(dir, 'content'),
        path.join(dir, 'Content'),
        path.join(dir, 'text'),
        path.join(dir, 'TEXT'),
        path.join(dir, 'xhtml'),
        path.join(dir, 'XHTML'),
        path.join(dir, 'html'),
        path.join(dir, 'HTML'),
        path.join(dir, 'pages'),
        path.join(dir, 'chapters')
      ];
      
      // 检查这些目录是否存在并搜索HTML文件
      for (const contentDir of commonContentDirs) {
        if (fs.existsSync(contentDir)) {
          console.log(`检查目录: ${contentDir}`);
          const filesInDir = await fs.readdir(contentDir);
          
          // 对文件按章节数字顺序排序
          const sortedFiles = filesInDir.sort((a, b) => {
            // 尝试从文件名提取数字
            const numA = a.match(/\d+/);
            const numB = b.match(/\d+/);
            
            if (numA && numB) {
              return parseInt(numA[0]) - parseInt(numB[0]);
            }
            return a.localeCompare(b);
          });
          
          for (const file of sortedFiles) {
            const filePath = path.join(contentDir, file);
            const stats = await fs.stat(filePath);
            
            if (!stats.isDirectory()) {
              const ext = path.extname(file).toLowerCase();
              
              if (ext === '.html' || ext === '.xhtml' || ext === '.htm') {
                htmlFiles.push({
                  id: `html_${htmlFiles.length}`,
                  path: filePath,
                  href: path.relative(dir, filePath)
                });
              } else if (ext === '.css') {
                cssFiles.push({
                  id: `css_${cssFiles.length}`,
                  path: filePath,
                  href: path.relative(dir, filePath)
                });
              } else if (['.jpg', '.jpeg', '.png', '.gif', '.svg'].includes(ext)) {
                imageFiles.push({
                  id: `img_${imageFiles.length}`,
                  path: filePath,
                  href: path.relative(dir, filePath)
                });
              }
            }
          }
        }
      }
    }
    
    // 尝试提取所有包含"chapter"、"content"、"page"关键字的文件
    if (htmlFiles.length === 0) {
      console.log('搜索包含特定关键字的文件...');
      
      const findByKeywords = async (directory) => {
        try {
          const files = await fs.readdir(directory);
          
          for (const file of files) {
            const filePath = path.join(directory, file);
            const stats = await fs.stat(filePath);
            
            if (stats.isDirectory()) {
              await findByKeywords(filePath);
            } else {
              const lowerFile = file.toLowerCase();
              
              // 检查关键字
              const isContentFile = 
                lowerFile.includes('chapter') || 
                lowerFile.includes('content') || 
                lowerFile.includes('page') || 
                lowerFile.includes('text') || 
                lowerFile.includes('section') ||
                lowerFile.match(/^\d+\.(html|xhtml|htm)$/); // 数字命名的HTML文件
                
              const ext = path.extname(lowerFile);
              
              if (isContentFile && (ext === '.html' || ext === '.xhtml' || ext === '.htm')) {
                htmlFiles.push({
                  id: `keyword_${htmlFiles.length}`,
                  path: filePath,
                  href: path.relative(dir, filePath)
                });
              }
            }
          }
        } catch (error) {
          console.warn(`搜索关键字文件失败 (${directory}): ${error.message}`);
        }
      };
      
      await findByKeywords(dir);
    }
    
    // 如果仍然没有找到HTML文件，尝试读取所有疑似EPUB相关的XML文件
    if (htmlFiles.length === 0) {
      console.log('尝试解析XML文件获取内容信息...');
      
      // 递归查找所有XML文件
      const findXmlFiles = async (directory) => {
        const xmlFiles = [];
        
        const traverse = async (dir) => {
          try {
            const files = await fs.readdir(dir);
            
            for (const file of files) {
              const filePath = path.join(dir, file);
              const stats = await fs.stat(filePath);
              
              if (stats.isDirectory()) {
                await traverse(filePath);
              } else if (file.endsWith('.xml') || file.endsWith('.opf')) {
                xmlFiles.push(filePath);
              }
            }
          } catch (error) {
            console.warn(`遍历目录失败 (${dir}): ${error.message}`);
          }
        };
        
        await traverse(directory);
        return xmlFiles;
      };
      
      const xmlFiles = await findXmlFiles(dir);
      console.log(`找到 ${xmlFiles.length} 个XML文件`);
      
      // 解析所有XML文件，寻找文件引用
      for (const xmlFile of xmlFiles) {
        try {
          const xmlContent = await fs.readFile(xmlFile, 'utf8');
          
          // 查找引用的href属性
          const hrefMatches = xmlContent.match(/href=["']([^"']+\.(html|xhtml|htm))["']/g);
          
          if (hrefMatches && hrefMatches.length > 0) {
            const xmlDir = path.dirname(xmlFile);
            
            for (const match of hrefMatches) {
              const href = match.replace(/href=["']([^"']+)["']/, '$1');
              const filePath = path.join(xmlDir, href);
              
              if (fs.existsSync(filePath)) {
                htmlFiles.push({
                  id: `xml_ref_${htmlFiles.length}`,
                  path: filePath,
                  href: path.relative(dir, filePath)
                });
              }
            }
          }
        } catch (error) {
          console.warn(`解析XML文件失败 (${xmlFile}): ${error.message}`);
        }
      }
    }
    
    // 创建简单目录
    let tocItems = [];
    
    if (htmlFiles.length > 0) {
      // 尝试从HTML文件中提取标题
      for (let i = 0; i < htmlFiles.length; i++) {
        try {
          if (fs.existsSync(htmlFiles[i].path)) {
            const content = await fs.readFile(htmlFiles[i].path, 'utf8');
            const $ = cheerio.load(content);
            const title = $('title').text() || 
                     $('h1').first().text() || 
                     $('h2').first().text() || 
                     `章节 ${i + 1}`;
            
            tocItems.push({
              title: title,
              href: htmlFiles[i].href
            });
          } else {
            tocItems.push({
              title: `章节 ${i + 1}`,
              href: htmlFiles[i].href
            });
          }
        } catch (error) {
          console.warn(`提取章节标题失败: ${error.message}`);
          tocItems.push({
            title: `章节 ${i + 1}`,
            href: htmlFiles[i].href
          });
        }
      }
    }
    
    return {
      htmlFiles,
      cssFiles,
      imageFiles,
      tocItems
    };
  } catch (error) {
    console.error(`直接搜索内容文件失败: ${error.message}`);
    return {
      htmlFiles: [],
      cssFiles: [],
      imageFiles: [],
      tocItems: []
    };
  }
}

/**
 * 递归查找文件
 * @param {string} dir - 要搜索的目录
 * @param {Array} htmlFiles - HTML文件列表
 * @param {Array} cssFiles - CSS文件列表
 * @param {Array} imageFiles - 图片文件列表
 * @param {string} baseDir - 基础目录，用于计算相对路径
 * @returns {Promise<void>}
 */
async function findFiles(dir, htmlFiles, cssFiles, imageFiles, baseDir) {
  try {
    const files = await fs.readdir(dir);
    const rootDir = baseDir || dir;
    
    for (const file of files) {
      const filePath = path.join(dir, file);
      const stats = await fs.stat(filePath);
      
      if (stats.isDirectory()) {
        // 递归查找子目录
        await findFiles(filePath, htmlFiles, cssFiles, imageFiles, rootDir);
      } else {
        const ext = path.extname(file).toLowerCase();
        
        if (ext === '.html' || ext === '.xhtml' || ext === '.htm') {
          console.log(`找到HTML文件: ${filePath}`);
          htmlFiles.push({
            id: `html_${htmlFiles.length}`,
            path: filePath,
            href: path.relative(rootDir, filePath)
          });
        } else if (ext === '.css') {
          cssFiles.push({
            id: `css_${cssFiles.length}`,
            path: filePath,
            href: path.relative(rootDir, filePath)
          });
        } else if (['.jpg', '.jpeg', '.png', '.gif', '.svg'].includes(ext)) {
          imageFiles.push({
            id: `img_${imageFiles.length}`,
            path: filePath,
            href: path.relative(rootDir, filePath)
          });
        }
      }
    }
  } catch (error) {
    console.warn(`查找文件失败 (${dir}): ${error.message}`);
  }
}

/**
 * 获取章节内容
 * @param {Object} book - EPUB对象
 * @param {string} chapterId - 章节ID
 * @returns {Promise<string>} - 章节内容
 */
function getChapterContent(book, chapterId) {
  if (!book || !chapterId) {
    return Promise.reject(new Error('无效的book对象或chapterId'));
  }

  return new Promise((resolve, reject) => {
    try {
      book.getChapter(chapterId, (error, text) => {
        if (error) {
          reject(error);
        } else {
          resolve(text);
        }
      });
    } catch (error) {
      reject(new Error(`获取章节内容异常: ${error.message}`));
    }
  });
}

/**
 * 获取资源内容
 * @param {Object} book - EPUB对象
 * @param {string} resourcePath - 资源路径
 * @returns {Promise<Buffer|string>} - 资源内容
 */
function getResourceContent(book, resourcePath) {
  if (!book || !resourcePath) {
    return Promise.reject(new Error('无效的book对象或resourcePath'));
  }

  return new Promise((resolve, reject) => {
    try {
      book.getImage(resourcePath, (error, data, mimeType) => {
        if (error) {
          // 尝试以其他方式获取资源
          try {
            if (book.resources && book.resources[resourcePath]) {
              resolve(book.resources[resourcePath]);
              return;
            }
          } catch (e) {
            // 忽略并继续
          }
          reject(error);
        } else {
          resolve(data);
        }
      });
    } catch (error) {
      reject(new Error(`获取资源内容异常: ${error.message}`));
    }
  });
}

/**
 * 创建合并的HTML文件
 * @param {Object} epubContent - EPUB内容数据
 * @param {string} tempDir - 临时目录
 * @returns {Promise<string>} - 合并HTML文件路径
 */
async function createConsolidatedHtml(epubContent, tempDir) {
  try {
    console.log('创建合并HTML文件...');
    
    if (!epubContent || !epubContent.htmlFiles || epubContent.htmlFiles.length === 0) {
      throw new Error('无有效的HTML文件可合并');
    }
    
    const { htmlFiles, cssFiles, imageFiles, tocItems } = epubContent;
    
    // 创建HTML头部
    let htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>转换的EPUB文档</title>
        <style>
          body {
            font-family: "Noto Serif", "Noto Serif SC", serif;
            line-height: 1.6;
            padding: 20px;
            max-width: 800px;
            margin: 0 auto;
          }
          h1, h2, h3, h4, h5, h6 {
            page-break-after: avoid;
            page-break-inside: avoid;
          }
          img {
            max-width: 100%;
            height: auto;
          }
          table {
            border-collapse: collapse;
            width: 100%;
            margin: 15px 0;
          }
          table, th, td {
            border: 1px solid #ddd;
          }
          th, td {
            padding: 8px;
            text-align: left;
          }
          pre, code {
            background-color: #f5f5f5;
            padding: 0.2em 0.4em;
            border-radius: 3px;
            font-family: monospace;
            overflow-x: auto;
          }
          pre {
            padding: 10px;
          }
          a {
            color: #0066cc;
            text-decoration: none;
          }
          hr {
            border: none;
            border-top: 1px solid #ddd;
            margin: 20px 0;
          }
          .toc {
            margin-bottom: 40px;
            border: 1px solid #ddd;
            padding: 15px;
            background-color: #f9f9f9;
          }
          .toc h2 {
            margin-top: 0;
          }
          .toc ul {
            padding-left: 20px;
          }
          .toc li {
            margin-bottom: 5px;
          }
          .page-break {
            page-break-before: always;
          }
          .chapter {
            page-break-before: always;
          }
          .chapter:first-child {
            page-break-before: avoid;
          }
        </style>
    `;
    
    // 添加外部CSS
    if (cssFiles && cssFiles.length > 0) {
      console.log(`添加 ${cssFiles.length} 个CSS文件到HTML中`);
      
      for (const cssFile of cssFiles) {
        try {
          if (cssFile.path && fs.existsSync(cssFile.path)) {
            let cssContent = await fs.readFile(cssFile.path, 'utf8');
            // 修复CSS中的相对路径
            cssContent = fixCssRelativePaths(cssContent, cssFile.href);
            htmlContent += `<style>${cssContent}</style>`;
          }
        } catch (error) {
          console.warn(`添加CSS文件失败 (${cssFile.path}): ${error.message}`);
        }
      }
    }
    
    // 完成头部
    htmlContent += `
      </head>
      <body>
    `;
    
    // 添加标题和目录
    if (tocItems && tocItems.length > 0) {
      htmlContent += `
        <div class="toc">
          <h2>目录</h2>
          <ul>
      `;
      
      for (let i = 0; i < tocItems.length; i++) {
        htmlContent += `<li><a href="#chapter-${i}">${tocItems[i].title}</a></li>`;
      }
      
      htmlContent += `
          </ul>
        </div>
      `;
    }
    
    // 添加章节内容
    for (let i = 0; i < htmlFiles.length; i++) {
      try {
        const htmlFile = htmlFiles[i];
        if (!htmlFile.path || !fs.existsSync(htmlFile.path)) {
          console.warn(`HTML文件不存在: ${htmlFile.path}`);
          continue;
        }
        
        console.log(`添加章节 ${i+1}: ${htmlFile.path}`);
        
        // 读取HTML文件内容
        let chapterContent = await fs.readFile(htmlFile.path, 'utf8');
        
        // 修复章节中的相对路径
        chapterContent = fixHtmlRelativePaths(chapterContent, htmlFile.href, imageFiles);
        
        // 提取HTML内容主体部分
        const bodyContent = extractBodyContent(chapterContent);
        
        // 添加章节标题和内容
        const title = tocItems[i]?.title || `章节 ${i+1}`;
        
        htmlContent += `
          <div class="chapter" id="chapter-${i}">
            <h1>${title}</h1>
            ${bodyContent}
          </div>
        `;
      } catch (error) {
        console.warn(`处理章节内容失败: ${error.message}`);
      }
    }
    
    // 结束HTML
    htmlContent += `
      </body>
      </html>
    `;
    
    // 写入合并的HTML文件
    const outputPath = path.join(tempDir, 'consolidated.html');
    await fs.writeFile(outputPath, htmlContent);
    
    console.log(`已创建合并HTML文件: ${outputPath}`);
    return outputPath;
  } catch (error) {
    console.error(`创建合并HTML失败: ${error.message}`);
    throw error;
  }
}

/**
 * 修复CSS中的相对路径
 * @param {string} cssContent - CSS内容
 * @param {string} cssPath - CSS路径
 * @returns {string} - 修复后的CSS内容
 */
function fixCssRelativePaths(cssContent, cssPath) {
  try {
    // 获取CSS所在目录作为基路径
    const baseDir = path.dirname(cssPath);
    
    // 替换url()引用
    return cssContent.replace(/url\(['"]?([^'")]+)['"]?\)/g, (match, url) => {
      // 如果已经是绝对URL或数据URL，不做修改
      if (url.startsWith('http') || url.startsWith('data:')) {
        return match;
      }
      
      // 构建相对URL
      const resolvedUrl = `./images/${path.basename(url)}`;
      return `url('${resolvedUrl}')`;
    });
  } catch (error) {
    console.warn(`修复CSS路径失败: ${error.message}`);
    return cssContent;
  }
}

/**
 * 修复HTML中的相对路径
 * @param {string} htmlContent - HTML内容
 * @param {string} htmlPath - HTML路径
 * @param {Array} imageFiles - 图片文件
 * @returns {string} - 修复后的HTML内容
 */
function fixHtmlRelativePaths(htmlContent, htmlPath, imageFiles) {
  try {
    // 获取HTML所在目录作为基路径
    const baseDir = path.dirname(htmlPath);
    const $ = cheerio.load(htmlContent);
    
    // 修复图片路径
    $('img').each((_, el) => {
      const src = $(el).attr('src');
      if (src && !src.startsWith('http') && !src.startsWith('data:')) {
        // 查找匹配的图片文件
        const relativePath = path.join(baseDir, src);
        const imageFile = imageFiles.find(img => 
          img.href === src || 
          img.href === relativePath || 
          path.basename(img.href) === path.basename(src)
        );
        
        if (imageFile && imageFile.path) {
          $(el).attr('src', `./images/${path.basename(imageFile.path)}`);
        } else {
          console.warn(`未找到图片: ${src}`);
        }
      }
    });
    
    // 移除不必要的元素
    $('script').remove();
    
    return $.html();
  } catch (error) {
    console.warn(`修复HTML路径失败: ${error.message}`);
    return htmlContent;
  }
}

/**
 * 提取HTML内容中的body部分
 * @param {string} htmlContent - HTML内容
 * @returns {string} - 提取的body内容
 */
function extractBodyContent(htmlContent) {
  try {
    const $ = cheerio.load(htmlContent);
    
    // 优先查找body元素
    if ($('body').length > 0) {
      return $('body').html() || '';
    }
    
    // 如果没有body标签，返回整个HTML
    return $.html();
  } catch (error) {
    console.warn(`提取body内容失败: ${error.message}`);
    return htmlContent;
  }
}

/**
 * 将HTML转换为PDF
 * @param {string} htmlPath - HTML文件路径
 * @param {string} outputPath - 输出PDF路径
 * @param {Function} progressCallback - 进度回调
 */
async function convertHtmlToPdf(htmlPath, outputPath, progressCallback = null) {
  if (!htmlPath || !fs.existsSync(htmlPath)) {
    throw new Error(`HTML文件不存在: ${htmlPath}`);
  }
  
  if (!outputPath) {
    throw new Error('无效的PDF输出路径');
  }
  
  console.log(`开始将HTML转换为PDF: ${htmlPath} -> ${outputPath}`);
  if (typeof progressCallback === 'function') progressCallback(0.7, '开始生成PDF');
  
  // 确保输出目录存在
  await fs.ensureDir(path.dirname(outputPath));
  
  // 尝试使用系统已安装的Chrome
  let browser;
  
  try {
    // 首先尝试使用puppeteer内置的浏览器
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    console.log('使用puppeteer内置的Chrome');
  } catch (error) {
    console.log(`使用内置Chrome失败: ${error.message}`);
    console.log('尝试使用系统Chrome浏览器...');
    
    // 可能的Chrome路径
    const possiblePaths = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', // macOS
      '/usr/bin/google-chrome',                                       // Linux
      '/usr/bin/chromium-browser',                                    // Linux Chromium
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',   // Windows
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'  // Windows 32bit
    ];
    
    // 检查系统中是否存在Chrome
    let chromePath = null;
    for (const path of possiblePaths) {
      try {
        if (fs.existsSync(path)) {
          chromePath = path;
          console.log(`找到Chrome浏览器路径: ${chromePath}`);
          break;
        }
      } catch (e) {
        // 忽略错误，继续检查下一个路径
      }
    }
    
    if (!chromePath) {
      throw new Error('无法找到Chrome浏览器，请安装Google Chrome后重试，或确保puppeteer正确安装了Chromium');
    }
    
    browser = await puppeteer.launch({
      headless: true,
      executablePath: chromePath,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    console.log(`使用系统Chrome: ${chromePath}`);
  }
  
  try {
    const page = await browser.newPage();
    if (typeof progressCallback === 'function') progressCallback(0.8, '正在生成PDF');
    
    // 设置字体以支持中文
    await page.evaluateOnNewDocument(() => {
      document.documentElement.style.fontFamily = "'NotoSansSC', 'PingFang SC', 'Microsoft YaHei', sans-serif";
    });
    
    console.log(`正在加载HTML: file://${htmlPath}`);
    const response = await page.goto(`file://${htmlPath}`, { 
      waitUntil: 'networkidle0',
      timeout: 60000 // 增加超时时间到60秒
    });
    
    if (!response.ok()) {
      console.warn(`HTML加载警告: ${response.status()}: ${response.statusText()}`);
    }
    
    console.log('正在生成PDF...');
    if (typeof progressCallback === 'function') progressCallback(0.9, '正在写入PDF文件');
    
    // 设置PDF选项
    await page.pdf({
      path: outputPath,
      format: 'A4',
      margin: {
        top: '20mm',
        right: '20mm',
        bottom: '20mm',
        left: '20mm'
      },
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div style="width: 100%; text-align: right; font-size: 8px; margin-right: 10mm;"></div>',
      footerTemplate: '<div style="width: 100%; text-align: center; font-size: 8px;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>'
    });
    
    console.log(`PDF生成成功: ${outputPath}`);
    if (typeof progressCallback === 'function') progressCallback(1, '转换完成');
  } catch (error) {
    console.error(`PDF生成失败: ${error.message}`);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
      console.log('浏览器已关闭');
    }
  }
}

// 导出的函数
module.exports = {
  convertEpubToPdf,
  preprocessEpub,
  parseEpub,
  extractEpubDirectly,
  createConsolidatedHtml,
  convertHtmlToPdf
}; 