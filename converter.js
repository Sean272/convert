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
const MAX_TRANSLATE_LENGTH = parseInt(process.env.MAX_TRANSLATE_LENGTH || 9000); // 增加最大翻译长度限制
const TRANSLATE_DELAY = parseInt(process.env.TRANSLATE_DELAY || 6000); // 翻译请求间隔提高到6秒
const MAX_RETRY_ATTEMPTS = parseInt(process.env.MAX_RETRY_ATTEMPTS || 5); // 最大重试次数
const RETRY_DELAY_BASE = parseInt(process.env.RETRY_DELAY_BASE || 5000); // 重试基本延迟5秒
const BATCH_CHAR_LIMIT = parseInt(process.env.BATCH_CHAR_LIMIT || 3000); // 每批翻译的字符数

// API配置
const TRANSLATOR_API = process.env.TRANSLATOR_API || 'SIMULATE'; // 默认使用模拟翻译
const SILICONFLOW_API_KEY = process.env.SILICONFLOW_API_KEY;
const SILICONFLOW_API_URL = process.env.SILICONFLOW_API_URL || 'https://api.siliconflow.cn/v1/chat/completions';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_API_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions';

/**
 * 智能切分文本，确保在句子边界处切分
 * @param {string} text - 要切分的文本
 * @param {number} maxLength - 每个片段的最大长度
 * @returns {string[]} - 切分后的文本片段数组
 */
function smartSplitText(text, maxLength = 2000) {
  if (!text || text.length <= maxLength) {
    return [text];
  }

  // 句子边界的正则表达式
  const sentenceBoundary = /[.!?。！？]\s+/g;
  const segments = [];
  let start = 0;

  while (start < text.length) {
    if (start + maxLength >= text.length) {
      segments.push(text.substring(start));
      break;
    }

    // 找出当前范围内的所有句子边界
    let end = start + maxLength;
    const searchText = text.substring(start, end);
    const matches = [...searchText.matchAll(sentenceBoundary)];
    
    if (matches.length > 0) {
      // 使用最后一个句子边界作为切分点
      const lastMatch = matches[matches.length - 1];
      const boundaryIndex = start + lastMatch.index + 1; // +1 包含句号
      segments.push(text.substring(start, boundaryIndex));
      start = boundaryIndex + 1; // +1 跳过空格
    } else {
      // 如果没有找到句子边界，则在单词边界处切分
      const wordBoundary = /\s+/g;
      const wordMatches = [...searchText.matchAll(wordBoundary)].reverse();
      
      if (wordMatches.length > 0) {
        // 使用最后一个单词边界
        const lastWordMatch = wordMatches[0];
        const wordIndex = start + lastWordMatch.index;
        segments.push(text.substring(start, wordIndex));
        start = wordIndex + 1;
      } else {
        // 如果连单词边界都没有，则强制切分
        segments.push(text.substring(start, end));
        start = end;
      }
    }
  }

  return segments;
}

/**
 * 使用硅基流动API翻译文本到中文（支持长文本自动分段）
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

  // 对长文本进行智能分段
  const maxSegmentLength = 3000; // 每段最大长度
  const segments = smartSplitText(text, maxSegmentLength);
  
  if (segments.length > 1) {
    console.log(`文本过长，已分成${segments.length}段进行翻译`);
  }

  let translatedText = '';
  
  // 逐段翻译
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    
    try {
      console.log(`翻译第${i+1}/${segments.length}段: ${segment.substring(0, 50)}${segment.length > 50 ? '...' : ''}`);
      
      // 打印完整请求信息以便调试
      console.log(`API请求URL: ${SILICONFLOW_API_URL}`);
      console.log(`API密钥前几位: ${SILICONFLOW_API_KEY.substring(0, 10)}...`);
      
      const payload = {
        model: "Pro/deepseek-ai/DeepSeek-R1",  // 使用完整的模型ID
        messages: [
          { 
            role: "system", 
            content: "你是一个专业的翻译助手，请将提供的英文内容翻译成流畅自然的中文。只返回翻译结果，不要添加任何解释或额外内容。" 
          },
          { 
            role: "user", 
            content: segment 
          }
        ],
        temperature: 0.3,
        max_tokens: 4000
      };
      
      console.log(`请求载荷: ${JSON.stringify(payload)}`);
      
      const response = await fetch(SILICONFLOW_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SILICONFLOW_API_KEY.trim()}`  // 确保移除任何空格
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        // 详细记录错误信息
        const responseText = await response.text();
        console.error(`硅基流动API错误状态码: ${response.status}, 响应内容: ${responseText}`);
        console.error(`完整请求信息: ${JSON.stringify({
          url: SILICONFLOW_API_URL,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SILICONFLOW_API_KEY.substring(0, 10)}...`
          },
          body: JSON.stringify(payload)
        })}`);
        
        try {
          const errorData = JSON.parse(responseText);
          throw new Error(`硅基流动API调用失败: ${errorData.error?.message || errorData.message || response.statusText || '未知错误'}`);
        } catch (jsonError) {
          throw new Error(`硅基流动API调用失败: ${response.statusText}, 响应: ${responseText}`);
        }
      }

      const data = await response.json();
      if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        throw new Error(`硅基流动API返回数据格式不正确: ${JSON.stringify(data)}`);
      }
      
      const segmentTranslation = data.choices[0].message.content.trim();
      translatedText += (i > 0 ? ' ' : '') + segmentTranslation;
      console.log(`硅基流动翻译成功，翻译了${segment.length}个字符`);
      
      // 添加延迟避免API限流
      if (i < segments.length - 1) {
        const delay = parseInt(process.env.TRANSLATE_DELAY || 1000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    } catch (error) {
      console.error(`硅基流动翻译第${i+1}段失败: ${error.message}`);
      // 如果DeepSeek-V3失败，尝试使用DeepSeek-R1
      if (error.message.includes('Model does not exist') || error.message.includes('调用失败')) {
        console.log('尝试使用DeepSeek-R1模型...');
        try {
          const payload = {
            model: "deepseek-ai/DeepSeek-R1",  // 尝试备用模型
            messages: [
              { 
                role: "system", 
                content: "你是一个专业的翻译助手，请将提供的英文内容翻译成流畅自然的中文。只返回翻译结果，不要添加任何解释或额外内容。" 
              },
              { 
                role: "user", 
                content: segment 
              }
            ],
            temperature: 0.3,
            max_tokens: 4000
          };
          
          const response = await fetch(SILICONFLOW_API_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${SILICONFLOW_API_KEY.trim()}`
            },
            body: JSON.stringify(payload)
          });
          
          if (!response.ok) {
            const responseText = await response.text();
            console.error(`备用模型调用失败: ${response.status}, ${responseText}`);
            throw new Error(`备用模型调用失败: ${responseText}`);
          }
          
          const data = await response.json();
          if (!data.choices || !data.choices[0] || !data.choices[0].message) {
            throw new Error(`备用模型返回数据格式不正确: ${JSON.stringify(data)}`);
          }
          
          const segmentTranslation = data.choices[0].message.content.trim();
          translatedText += (i > 0 ? ' ' : '') + segmentTranslation;
          console.log(`备用模型翻译成功，翻译了${segment.length}个字符`);
          
          // 添加延迟避免API限流
          if (i < segments.length - 1) {
            const delay = parseInt(process.env.TRANSLATE_DELAY || 1000);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        } catch (backupError) {
          console.error(`备用模型也失败: ${backupError.message}`);
          throw error; // 继续抛出原始错误
        }
      } else {
        throw error;
      }
    }
  }
  
  return translatedText;
}

/**
 * 使用DeepSeek官方API翻译文本到中文（支持长文本自动分段）
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

  // 对长文本进行智能分段
  const maxSegmentLength = 3000; // 每段最大长度
  const segments = smartSplitText(text, maxSegmentLength);
  
  if (segments.length > 1) {
    console.log(`文本过长，已分成${segments.length}段进行翻译`);
  }

  let translatedText = '';
  
  // 逐段翻译
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    
    try {
      console.log(`翻译第${i+1}/${segments.length}段: ${segment.substring(0, 50)}${segment.length > 50 ? '...' : ''}`);
      
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
              content: segment 
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
      
      const segmentTranslation = data.choices[0].message.content.trim();
      translatedText += (i > 0 ? ' ' : '') + segmentTranslation;
      console.log(`DeepSeek翻译成功，翻译了${segment.length}个字符`);
      
      // 添加延迟避免API限流
      if (i < segments.length - 1) {
        const delay = parseInt(process.env.TRANSLATE_DELAY || 1000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    } catch (error) {
      console.error(`DeepSeek翻译第${i+1}段失败: ${error.message}`);
      throw error;
    }
  }
  
  return translatedText;
}

/**
 * 使用Google翻译API翻译文本到中文（支持长文本自动分段）
 * @param {string} text - 待翻译文本
 * @returns {Promise<string>} - 翻译后的文本
 */
async function translateWithGoogle(text) {
  if (!text || text.trim() === '') {
    return text;
  }

  // 对长文本进行智能分段
  const maxSegmentLength = 5000; // Google翻译API支持更长的文本
  const segments = smartSplitText(text, maxSegmentLength);
  
  if (segments.length > 1) {
    console.log(`文本过长，已分成${segments.length}段进行Google翻译`);
  }

  let translatedText = '';
  
  // 逐段翻译
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    
    try {
      console.log(`使用Google翻译第${i+1}/${segments.length}段: ${segment.substring(0, 50)}${segment.length > 50 ? '...' : ''}`);
      
      const { text: segmentTranslation } = await translate(segment, { to: 'zh-CN' });
      translatedText += (i > 0 ? ' ' : '') + segmentTranslation;
      console.log(`Google翻译成功，翻译了 ${segment.length} 个字符`);
      
      // 添加延迟避免API限流
      if (i < segments.length - 1) {
        const delay = parseInt(process.env.TRANSLATE_DELAY || 1000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    } catch (error) {
      console.error(`Google翻译第${i+1}段失败: ${error.message}`);
      throw error;
    }
  }
  
  return translatedText;
}

/**
 * 翻译文本
 * @param {string} text - 要翻译的文本
 * @param {number} retryCount - 重试次数
 * @returns {Promise<string>} - 翻译后的文本
 */
async function translateText(text, retryCount = 0) {
  // 缓存已经翻译过的内容，避免重复请求API
  if (!translateText.cache) {
    translateText.cache = new Map();
  }
  
  // 检查缓存中是否已经有此文本的翻译
  if (translateText.cache.has(text)) {
    console.log(`使用缓存的翻译结果，节省API请求`);
    return translateText.cache.get(text);
  }
  
  try {
    // 检查是否是空文本或只包含特殊字符的文本
    if (!text || text.trim().length === 0 || !/[a-zA-Z]{3,}/.test(text)) {
      return text;
    }
    
    console.log(`使用${TRANSLATOR_API.toLowerCase()}API翻译...`);
    console.log(`使用${TRANSLATOR_API.toLowerCase()}API翻译: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`);
    
    let translatedText = '';
    
    // 尝试各种翻译方法
    if (TRANSLATOR_API.toUpperCase() === 'SIMULATE') {
      translatedText = simulateTranslation(text);
    } else if (TRANSLATOR_API.toUpperCase() === 'GOOGLE') {
      translatedText = await translateWithGoogle(text);
    } else if (TRANSLATOR_API.toUpperCase() === 'SILICONFLOW') {
      translatedText = await translateWithSiliconFlow(text);
    } else if (TRANSLATOR_API.toUpperCase() === 'DEEPSEEK') {
      translatedText = await translateWithDeepSeek(text);
    } else {
      // 默认使用模拟翻译
      translatedText = simulateTranslation(text);
    }
    
    // 如果翻译成功，保存到缓存中
    if (translatedText && translatedText.trim().length > 0) {
      translateText.cache.set(text, translatedText);
    }
    
    return translatedText;
  } catch (error) {
    console.error(`翻译API调用失败: ${error.message}`);
    
    // 如果重试次数在限制内，尝试重试
    if (retryCount < 2) {
      console.log(`尝试重试翻译，重试次数: ${retryCount + 1}/2`);
      await new Promise(resolve => setTimeout(resolve, 2000)); // 等待2秒再重试
      return translateText(text, retryCount + 1);
    }
    
    // 重试次数用尽，使用备选翻译
    console.log('使用模拟翻译作为备选方案');
    const backupTranslation = simulateTranslation(text);
    
    // 将备选翻译也加入缓存
    translateText.cache.set(text, backupTranslation);
    
    return backupTranslation;
  }
}

/**
 * 模拟翻译文本，用于测试
 * @param {string} text - 待翻译文本
 * @returns {string} - 模拟翻译后的文本
 */
function simulateTranslation(text) {
  if (!text || text.trim() === '') {
    return text;
  }

  console.log('使用模拟翻译...');
  
  // 创建简单的英文词汇到中文的映射
  const dictionary = {
    // 常用词汇
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
    'all': '所有',
    'have': '有',
    'has': '有',
    'had': '有',
    'do': '做',
    'does': '做',
    'did': '做',
    'will': '将会',
    'would': '会',
    'could': '可能会',
    'should': '应该',
    'can': '能够',
    'may': '可能',
    
    // 专业词汇
    'animal': '动物',
    'kingdom': '王国',
    'diversity': '多样性',
    'remarkable': '显著的',
    'varied': '多样的',
    'countless': '无数的',
    'ways': '方式',
    'conclude': '推断',
    'little': '很少',
    'almost': '几乎',
    'body': '身体',
    'plan': '计划',
    'front': '前部',
    'contains': '包含',
    'mouth': '嘴巴',
    'brain': '大脑',
    'sensory': '感觉',
    'organs': '器官',
    'eyes': '眼睛',
    'ears': '耳朵',
    'back': '背部',
    'waste': '废物',
    'evolutionary': '进化的',
    'biologists': '生物学家',
    'bilateral': '双侧的',
    'symmetry': '对称性',
    'contrast': '对比',
    'distant': '遥远的',
    'cousins': '亲戚',
    'coral': '珊瑚',
    'polyps': '水螅',
    'anemones': '海葵',
    'jellyfish': '水母',
    'radial': '辐射状的',
    'arranged': '排列',
    'central': '中心的',
    'axis': '轴',
    'difference': '差异',
    'categories': '类别',
    'food': '食物',
    'mouths': '嘴巴',
    'pooping': '排泄',
    'waste': '废物',
    'products': '产物',
    'butts': '臀部',
    'animals': '动物',
    'eat': '吃',
    'putting': '放入',
    'swallows': '吞咽',
    'stomachs': '胃',
    'spits': '吐出',
    'proper': '适当的',
    'bilaterians': '双侧对称动物',
    'symmetrical': '对称的',
    'opening': '开口',
    'undeniably': '不可否认地'
  };
  
  // 进行简单的词对词翻译
  let translatedText = text;
  Object.keys(dictionary).forEach(engWord => {
    const regex = new RegExp(`\\b${engWord}\\b`, 'gi');
    translatedText = translatedText.replace(regex, match => {
      // 保持原始大小写
      if (match === match.toLowerCase()) {
        return dictionary[engWord];
      } else if (match === match.toUpperCase()) {
        return dictionary[engWord].toUpperCase();
      } else if (match.charAt(0) === match.charAt(0).toUpperCase()) {
        return dictionary[engWord].charAt(0).toUpperCase() + dictionary[engWord].slice(1);
      }
      return dictionary[engWord];
    });
  });
  
  // 返回翻译结果
  return `【译文】${translatedText}`;
}

/**
 * 翻译HTML内容
 * @param {string} html - HTML内容字符串
 * @param {function} progressCallback - 进度回调函数
 * @returns {Promise<string>} - 翻译后的HTML
 */
async function translateHtml(html, progressCallback = null) {
  try {
    console.log('开始翻译HTML内容...');
    const $ = cheerio.load(html);
    
    // 通知初始进度
    if (typeof progressCallback === 'function') {
      progressCallback(65, '解析HTML内容...');
    }
    
    // 按章节处理而不是单独元素
    // 查找所有章节容器 - 大多数电子书使用div或section标签包装章节
    const chapters = $('body > div, body > section, .chapter, [id^="chapter"], [class*="chapter"]');
    console.log(`找到 ${chapters.length} 个潜在章节容器`);
    
    if (chapters.length === 0) {
      // 如果没有找到明确的章节，尝试使用标题作为分割点
      return await fallbackTranslateByHeadings($, html, progressCallback);
    }
    
    // 总章节数量
    const totalChapters = chapters.length;
    let processedCount = 0;
    
    // 处理每个章节
    for (let i = 0; i < chapters.length; i++) {
      const chapter = chapters.eq(i);
      const chapterTitle = chapter.find('h1, h2, h3').first().text().trim() || `章节 ${i+1}`;
      
      // 更新进度
      if (typeof progressCallback === 'function') {
        const progress = 65 + Math.floor((processedCount / totalChapters) * 20);
        progressCallback(progress, `翻译章节: ${chapterTitle} (${processedCount}/${totalChapters})...`);
      }
      
      // 获取章节中所有需要翻译的元素
      const elementsToTranslate = chapter.find('h1, h2, h3, h4, h5, h6, p, li').filter(function() {
        const text = $(this).text().trim();
        // 只处理有文本内容且不是仅包含数字或特殊字符的元素
        return text.length > 0 && /[a-zA-Z]{5,}/.test(text);
      });
      
      console.log(`章节 "${chapterTitle}" 中找到 ${elementsToTranslate.length} 个需要翻译的元素`);
      
      if (elementsToTranslate.length === 0) {
        continue; // 跳过空章节
      }
      
      // 章节中的所有文本内容合并处理，提高效率
      let chapterText = '';
      const elementMappings = [];
      
      // 为每个元素创建唯一标识符
      elementsToTranslate.each(function(index) {
        const element = $(this);
        const text = element.text().trim();
        
        if (text.length > 0) {
          // 使用索引创建唯一标记
          const marker = `[ELEMENT_${i}_${index}]`;
          chapterText += marker + text + marker + '\n\n';
          
          elementMappings.push({
            marker: marker,
            element: element,
            originalText: text
          });
        }
      });
      
      // 检查是否有内容需要翻译
      if (chapterText.trim() === '') {
        continue;
      }
      
      console.log(`批量翻译章节 "${chapterTitle}"，共 ${chapterText.length} 个字符`);
      
      // 如果章节内容过长，分段处理
      if (chapterText.length > BATCH_CHAR_LIMIT) {
        console.log(`章节内容超过字符限制(${BATCH_CHAR_LIMIT})，分段处理`);
        await processChapterInSegments($, chapterText, elementMappings, BATCH_CHAR_LIMIT);
      } else {
        // 整体翻译章节内容
        try {
          console.log(`整体翻译章节，长度: ${chapterText.length}`);
          const translatedChapterText = await translateText(chapterText);
          
          // 将翻译结果应用到各个元素
          for (const mapping of elementMappings) {
            // 提取对应元素的翻译内容
            const pattern = new RegExp(escapeRegExp(mapping.marker) + '(.*?)' + escapeRegExp(mapping.marker), 's');
            const match = translatedChapterText.match(pattern);
            
            if (match && match[1]) {
              const translatedElementText = match[1].trim();
              
              // 更好的双语格式: 中文(原文: 英文)
              if (translatedElementText.includes('【原文】')) {
                $(mapping.element).html(translatedElementText);
              } else {
                // 添加原文作为参考
                $(mapping.element).html(`${translatedElementText}<br><span style="font-size:0.9em;color:#666">【原文】${mapping.originalText}</span>`);
              }
            } else {
              console.warn(`未找到元素 "${mapping.originalText.substring(0, 30)}..." 的翻译结果，使用模拟翻译`);
              const simText = simulateTranslation(mapping.originalText);
              $(mapping.element).html(simText.replace('\n【原文】', '<br><span style="font-size:0.9em;color:#666">【原文】') + '</span>');
            }
          }
        } catch (error) {
          console.error(`章节翻译失败: ${error.message}，使用备用方法`);
          // 错误时逐个翻译重要元素
          await translateChapterElements($, elementsToTranslate);
        }
      }
      
      processedCount++;
      
      // 章节之间添加延迟
      if (i < chapters.length - 1) {
        console.log(`已处理 ${processedCount}/${totalChapters} 个章节，等待处理下一章节...`);
        await new Promise(resolve => setTimeout(resolve, TRANSLATE_DELAY / 2));
      }
    }
    
    // 通知进度完成
    if (typeof progressCallback === 'function') {
      progressCallback(85, 'HTML翻译完成，准备生成PDF...');
    }
    
    console.log('HTML翻译完成');
    return $.html();
  } catch (error) {
    console.error(`HTML翻译失败: ${error.message}`);
    
    // 失败时也要通知进度
    if (typeof progressCallback === 'function') {
      progressCallback(70, `翻译失败: ${error.message}`);
    }
    
    // 发生错误时返回原始HTML
    return html;
  }
}

/**
 * 按照标题分段翻译HTML内容(备用方法)
 * @param {CheerioStatic} $ - Cheerio对象
 * @param {string} html - 原始HTML内容 
 * @param {function} progressCallback - 进度回调函数
 * @returns {Promise<string>} - 翻译后的HTML
 */
async function fallbackTranslateByHeadings($, html, progressCallback) {
  console.log('使用标题分段翻译模式');
  
  // 查找所有标题元素
  const headings = $('h1, h2, h3, h4');
  console.log(`找到 ${headings.length} 个标题元素作为分段点`);
  
  if (headings.length === 0) {
    // 如果没有标题，使用原始方法
    console.log('没有找到标题元素，使用原始元素翻译方法');
    return await originalTranslateHtml(html, progressCallback);
  }
  
  // 收集各个部分并处理
  let currentHeading = null;
  let currentSection = [];
  const sections = [];
  
  headings.each(function(i) {
    if (currentHeading !== null) {
      // 收集当前标题下的所有元素
      let elem = currentHeading;
      while (elem.next().length && !elem.next().is('h1, h2, h3, h4')) {
        elem = elem.next();
        if (elem.is('p, li') && elem.text().trim().length > 0) {
          currentSection.push(elem);
        }
      }
      
      sections.push({
        heading: currentHeading,
        elements: currentSection
      });
    }
    
    currentHeading = $(this);
    currentSection = [];
  });
  
  // 处理最后一个部分
  if (currentHeading !== null) {
    let elem = currentHeading;
    while (elem.next().length) {
      elem = elem.next();
      if (elem.is('p, li') && elem.text().trim().length > 0) {
        currentSection.push(elem);
      }
    }
    
    sections.push({
      heading: currentHeading,
      elements: currentSection
    });
  }
  
  console.log(`共分割为 ${sections.length} 个内容部分`);
  
  // 翻译每个部分
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const headingText = section.heading.text().trim();
    
    // 更新进度
    if (typeof progressCallback === 'function') {
      const progress = 65 + Math.floor((i / sections.length) * 20);
      progressCallback(progress, `翻译部分: ${headingText} (${i+1}/${sections.length})...`);
    }
    
    // 翻译标题
    try {
      const translatedHeading = await translateText(headingText);
      if (translatedHeading.includes('【原文】')) {
        section.heading.html(translatedHeading);
      } else {
        section.heading.html(`${translatedHeading}<br><span style="font-size:0.9em;color:#666">【原文】${headingText}</span>`);
      }
    } catch (error) {
      console.warn(`标题翻译失败: ${error.message}`);
    }
    
    // 处理整个部分的文本
    if (section.elements.length > 0) {
      // 合并段落文本
      let sectionText = '';
      const elementMappings = [];
      
      section.elements.forEach((element, index) => {
        const text = $(element).text().trim();
        if (text.length > 0) {
          const marker = `[ELEMENT_${i}_${index}]`;
          sectionText += marker + text + marker + '\n\n';
          elementMappings.push({
            marker: marker,
            element: element,
            originalText: text
          });
        }
      });
      
      // 批量翻译内容
      if (sectionText.length > 0) {
        if (sectionText.length > BATCH_CHAR_LIMIT) {
          await processChapterInSegments($, sectionText, elementMappings, BATCH_CHAR_LIMIT);
        } else {
          try {
            const translatedSectionText = await translateText(sectionText);
            
            // 应用翻译结果
            for (const mapping of elementMappings) {
              const pattern = new RegExp(escapeRegExp(mapping.marker) + '(.*?)' + escapeRegExp(mapping.marker), 's');
              const match = translatedSectionText.match(pattern);
              
              if (match && match[1]) {
                const translatedElementText = match[1].trim();
                if (translatedElementText.includes('【原文】')) {
                  $(mapping.element).html(translatedElementText);
                } else {
                  $(mapping.element).html(`${translatedElementText}<br><span style="font-size:0.9em;color:#666">【原文】${mapping.originalText}</span>`);
                }
              } else {
                const simText = simulateTranslation(mapping.originalText);
                $(mapping.element).html(simText.replace('\n【原文】', '<br><span style="font-size:0.9em;color:#666">【原文】') + '</span>');
              }
            }
          } catch (error) {
            console.warn(`部分翻译失败: ${error.message}`);
            await translateElements($, section.elements);
          }
        }
      }
    }
    
    // 部分之间添加延迟
    if (i < sections.length - 1) {
      await new Promise(resolve => setTimeout(resolve, TRANSLATE_DELAY / 2));
    }
  }
  
  // 通知进度完成
  if (typeof progressCallback === 'function') {
    progressCallback(85, 'HTML翻译完成，准备生成PDF...');
  }
  
  return $.html();
}

/**
 * 分段处理大型章节内容
 * @param {CheerioStatic} $ - Cheerio对象
 * @param {string} chapterText - 章节文本
 * @param {Array<Object>} elementMappings - 元素映射
 * @param {number} segmentLimit - 分段大小限制
 */
async function processChapterInSegments($, chapterText, elementMappings, segmentLimit) {
  // 按元素分割章节内容
  const segments = [];
  let currentSegment = '';
  let currentMappings = [];
  
  for (const mapping of elementMappings) {
    const elementText = mapping.marker + mapping.originalText + mapping.marker + '\n\n';
    
    // 如果添加这个元素会超出限制，开始新的段落
    if (currentSegment.length + elementText.length > segmentLimit && currentSegment.length > 0) {
      segments.push({
        text: currentSegment,
        mappings: currentMappings
      });
      currentSegment = '';
      currentMappings = [];
    }
    
    currentSegment += elementText;
    currentMappings.push(mapping);
  }
  
  // 添加最后一个段落
  if (currentSegment.length > 0) {
    segments.push({
      text: currentSegment,
      mappings: currentMappings
    });
  }
  
  console.log(`章节内容分为 ${segments.length} 个片段进行处理`);
  
  // 处理每个片段
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    console.log(`处理片段 ${i+1}/${segments.length}，包含 ${segment.mappings.length} 个元素，共 ${segment.text.length} 个字符`);
    
    try {
      const translatedSegmentText = await translateText(segment.text);
      
      // 应用翻译结果
      for (const mapping of segment.mappings) {
        const pattern = new RegExp(escapeRegExp(mapping.marker) + '(.*?)' + escapeRegExp(mapping.marker), 's');
        const match = translatedSegmentText.match(pattern);
        
        if (match && match[1]) {
          const translatedElementText = match[1].trim();
          if (translatedElementText.includes('【原文】')) {
            $(mapping.element).html(translatedElementText);
          } else {
            $(mapping.element).html(`${translatedElementText}<br><span style="font-size:0.9em;color:#666">【原文】${mapping.originalText}</span>`);
          }
        } else {
          console.warn(`无法找到元素 "${mapping.originalText.substring(0, 30)}..." 的翻译，使用模拟翻译`);
          const simText = simulateTranslation(mapping.originalText);
          $(mapping.element).html(simText.replace('\n【原文】', '<br><span style="font-size:0.9em;color:#666">【原文】') + '</span>');
        }
      }
    } catch (error) {
      console.error(`片段翻译失败: ${error.message}`);
      
      // 逐个翻译元素
      for (const mapping of segment.mappings) {
        try {
          const translatedText = await translateText(mapping.originalText);
          if (translatedText.includes('【原文】')) {
            $(mapping.element).html(translatedText);
          } else {
            $(mapping.element).html(`${translatedText}<br><span style="font-size:0.9em;color:#666">【原文】${mapping.originalText}</span>`);
          }
        } catch (elemError) {
          console.warn(`元素翻译失败: ${elemError.message}`);
          const simText = simulateTranslation(mapping.originalText);
          $(mapping.element).html(simText.replace('\n【原文】', '<br><span style="font-size:0.9em;color:#666">【原文】') + '</span>');
        }
        
        // 添加短暂延迟
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    // 片段之间添加延迟
    if (i < segments.length - 1) {
      await new Promise(resolve => setTimeout(resolve, TRANSLATE_DELAY / 2));
    }
  }
}

/**
 * 翻译元素集合
 * @param {CheerioStatic} $ - Cheerio对象 
 * @param {Array<Element>} elements - 要翻译的元素
 */
async function translateElements($, elements) {
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i];
    const text = $(element).text().trim();
    
    if (text.length > 0) {
      try {
        const translatedText = await translateText(text);
        if (translatedText.includes('【原文】')) {
          $(element).html(translatedText);
        } else {
          $(element).html(`${translatedText}<br><span style="font-size:0.9em;color:#666">【原文】${text}</span>`);
        }
      } catch (error) {
        console.warn(`元素翻译失败: ${error.message}`);
        const simText = simulateTranslation(text);
        $(element).html(simText.replace('\n【原文】', '<br><span style="font-size:0.9em;color:#666">【原文】') + '</span>');
      }
      
      // 添加短暂延迟
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
}

/**
 * 翻译章节内的所有元素
 * @param {CheerioStatic} $ - Cheerio对象
 * @param {Array<Element>} elements - 要翻译的元素
 */
async function translateChapterElements($, elements) {
  return await translateElements($, elements);
}

/**
 * 用于正则表达式转义特殊字符
 * @param {string} string - 需要转义的字符串
 * @returns {string} - 转义后的字符串
 */
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 原始的逐元素翻译方法(兼容备用)
 * @param {string} html - HTML内容
 * @param {function} progressCallback - 进度回调函数
 * @returns {Promise<string>} - 翻译后的HTML
 */
async function originalTranslateHtml(html, progressCallback = null) {
  const $ = cheerio.load(html);
  
  // 获取所有需要翻译的元素
  const elements = $('h1, h2, h3, h4, h5, h6, p, li').filter(function() {
    const text = $(this).text().trim();
    // 只处理有文本内容且不是仅包含数字或特殊字符的元素
    return text.length > 0 && /[a-zA-Z]{5,}/.test(text);
  });
  
  console.log(`找到 ${elements.length} 个需要翻译的元素`);
  
  if (elements.length === 0) {
    console.log('没有找到需要翻译的元素，返回原HTML');
    return html;
  }
  
  // 总元素数量
  const totalElements = elements.length;
  let processedCount = 0;
  
  // 更大的批量大小，提高效率
  const BATCH_SIZE = 5; // 从2增加到5
  
  // 分批处理元素
  for (let i = 0; i < elements.length; i += BATCH_SIZE) {
    // 获取当前批次
    const batch = elements.slice(i, Math.min(i + BATCH_SIZE, elements.length));
    
    // 更新进度
    if (typeof progressCallback === 'function') {
      const progress = 65 + Math.floor((processedCount / totalElements) * 20);
      progressCallback(progress, `翻译中 (${processedCount}/${totalElements})...`);
    }
    
    // 处理当前批次
    await translateBatch($, batch);
    
    processedCount += batch.length;
    
    // 每个批次之间等待较短时间，提高效率
    if (i + BATCH_SIZE < elements.length) {
      console.log(`已处理 ${processedCount}/${totalElements} 个元素，等待下一批...`);
      const batchWaitTime = Math.max(TRANSLATE_DELAY/3, 1000);
      console.log(`批次间等待 ${batchWaitTime}ms...`);
      await new Promise(resolve => setTimeout(resolve, batchWaitTime));
    }
  }
  
  return $.html();
}

/**
 * 批量翻译元素
 * @param {CheerioStatic} $ - Cheerio对象
 * @param {Array} batch - 元素批次
 */
async function translateBatch($, batch) {
  // 收集每个元素的文本并记录映射
  const textsToTranslate = [];
  const elementMappings = [];
  let batchCharCount = 0; // 跟踪批次总字符数
  
  for (let j = 0; j < batch.length; j++) {
    const element = batch.eq(j);
    const originalText = element.text().trim();
    
    if (originalText.length > 0) {
      // 计算批次字符总数，确保不超过API限制
      if (batchCharCount + originalText.length > BATCH_CHAR_LIMIT) {
        // 如果添加这个元素会超出限制，结束当前批次
        console.log(`批次达到字符限制 ${batchCharCount}/${BATCH_CHAR_LIMIT}，停止添加更多元素`);
        break;
      }
      
      textsToTranslate.push(originalText);
      elementMappings.push({
        element: element, 
        originalText: originalText
      });
      batchCharCount += originalText.length;
    }
  }
  
  // 防止空批次
  if (textsToTranslate.length === 0) {
    return;
  }
  
  // 使用不容易出现在正常文本中的随机生成分隔符
  const timestamp = Date.now();
  const randomString = Math.random().toString(36).substring(2, 10);
  const SEPARATOR = `\n##--SPLIT_MARK_${timestamp}_${randomString}--##\n`;
  
  console.log(`批量翻译 ${textsToTranslate.length} 个元素，共 ${batchCharCount} 个字符`);
  
  // 两种翻译策略: 尝试批量翻译，如果失败则回退到单个翻译
  if (textsToTranslate.length > 1) {
    try {
      // 1. 尝试批量翻译
      const combinedText = textsToTranslate.join(SEPARATOR);
      const translatedCombined = await translateText(combinedText);
      const translatedParts = translatedCombined.split(SEPARATOR);
      
      // 验证拆分结果
      if (translatedParts.length === textsToTranslate.length) {
        // 应用翻译结果
        for (let k = 0; k < elementMappings.length; k++) {
          const mapping = elementMappings[k];
          const translatedText = translatedParts[k].trim();
          
          // 更好的双语格式: 中文(原文: 英文)
          if (translatedText.includes('【原文】')) {
            $(mapping.element).html(translatedText);
          } else {
            // 添加原文作为参考
            $(mapping.element).html(`${translatedText}<br><span style="font-size:0.9em;color:#666">【原文】${mapping.originalText}</span>`);
          }
        }
        console.log(`批次翻译成功，应用到 ${elementMappings.length} 个元素`);
      } else {
        throw new Error(`翻译结果拆分不匹配: 期望 ${textsToTranslate.length} 个部分，实际得到 ${translatedParts.length} 个部分`);
      }
    } catch (batchError) {
      console.warn(batchError.message);
      console.warn(`批量翻译失败，退回到单个元素翻译`);
      
      // 2. 批量失败，回退到逐个翻译
      for (const mapping of elementMappings) {
        try {
          console.log(`单独翻译: ${mapping.originalText.substring(0, 50)}${mapping.originalText.length > 50 ? '...' : ''}`);
          const translatedText = await translateText(mapping.originalText);
          
          // 更好的双语格式
          if (translatedText.includes('【原文】')) {
            $(mapping.element).html(translatedText);
          } else {
            $(mapping.element).html(`${translatedText}<br><span style="font-size:0.9em;color:#666">【原文】${mapping.originalText}</span>`);
          }
          
          // 避免请求过快，添加延迟
          await new Promise(resolve => setTimeout(resolve, TRANSLATE_DELAY / 2));
        } catch (singleError) {
          console.warn(`单独翻译元素失败: ${singleError.message}，使用模拟翻译`);
          const simText = simulateTranslation(mapping.originalText);
          $(mapping.element).html(simText.replace('\n【原文】', '<br><span style="font-size:0.9em;color:#666">【原文】') + '</span>');
        }
      }
    }
  } else {
    // 单个元素处理
    const mapping = elementMappings[0];
    try {
      console.log(`翻译单个元素: ${mapping.originalText.substring(0, 50)}${mapping.originalText.length > 50 ? '...' : ''}`);
      const translatedText = await translateText(mapping.originalText);
      
      // 更好的双语格式
      if (translatedText.includes('【原文】')) {
        $(mapping.element).html(translatedText);
      } else {
        $(mapping.element).html(`${translatedText}<br><span style="font-size:0.9em;color:#666">【原文】${mapping.originalText}</span>`);
      }
    } catch (error) {
      console.warn(`翻译元素失败: ${error.message}，使用模拟翻译`);
      const simText = simulateTranslation(mapping.originalText);
      $(mapping.element).html(simText.replace('\n【原文】', '<br><span style="font-size:0.9em;color:#666">【原文】') + '</span>');
    }
  }
}

/**
 * 处理一个翻译批次，并更新进度
 * @param {Array<string>} textBatch - 一批要翻译的文本
 * @param {Array<Object>} elementMappings - 元素映射信息
 * @param {CheerioStatic} $ - Cheerio对象
 * @param {function} progressCallback - 进度回调函数
 * @param {number} processedCount - 已处理元素数
 * @param {number} totalElements - 总元素数
 */
async function processBatchWithProgress(textBatch, elementMappings, $, progressCallback, processedCount, totalElements) {
  try {
    if (textBatch.length === 0) return;
    
    // 使用非常独特的分隔符，即使在翻译中也不太可能被改变
    const SEPARATOR = "\n###SPLIT_MARK_" + Date.now() + "###\n";
    const combinedText = textBatch.join(SEPARATOR);
    
    console.log(`批量翻译 ${textBatch.length} 个元素，共 ${combinedText.length} 个字符`);
    
    // 翻译合并后的文本
    const translatedCombined = await translateText(combinedText);
    
    // 根据分隔符拆分翻译结果
    const translatedParts = translatedCombined.split(SEPARATOR);
    
    // 确保结果数量与输入匹配
    if (translatedParts.length === textBatch.length) {
      // 将翻译结果应用回各个元素
      for (let i = 0; i < elementMappings.length; i++) {
        const mapping = elementMappings[i];
        $(mapping.element).text(translatedParts[i]);
      }
      console.log(`批次翻译完成，成功应用回 ${elementMappings.length} 个元素`);
    } else {
      console.warn(`翻译结果拆分不匹配: 期望 ${textBatch.length} 个部分，实际得到 ${translatedParts.length} 个部分`);
      
      // 单独翻译每个元素
      for (let i = 0; i < elementMappings.length; i++) {
        const mapping = elementMappings[i];
        const originalText = $(mapping.element).text();
        
        try {
          // 直接对每个元素进行单独翻译
          const translatedText = await translateText(originalText);
          $(mapping.element).text(translatedText);
          
          // 更新进度（从30%到85%的进度范围内）
          if (typeof progressCallback === 'function') {
            const currentElementIndex = processedCount + i;
            const progress = 30 + Math.floor((currentElementIndex / totalElements) * 55);
            if (i % 5 === 0 || i === elementMappings.length - 1) { // 每5个元素更新一次进度
              progressCallback(progress, `已翻译 ${currentElementIndex+1}/${totalElements} 个元素...`);
            }
          }
          
          // 添加短延迟
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (err) {
          console.error(`单独翻译元素失败: ${err.message}`);
          // 失败时使用模拟翻译
          $(mapping.element).text(simulateTranslation(originalText));
        }
      }
    }
    
    // 更新进度
    if (typeof progressCallback === 'function') {
      const progress = 30 + Math.floor(((processedCount + textBatch.length) / totalElements) * 55);
      progressCallback(progress, `已翻译 ${processedCount + textBatch.length}/${totalElements} 个元素...`);
    }
  } catch (error) {
    console.error(`批次处理失败: ${error.message}`);
    // 失败时使用模拟翻译
    for (const mapping of elementMappings) {
      const originalText = $(mapping.element).text();
      const simText = simulateTranslation(originalText);
      $(mapping.element).text(simText);
    }
    
    // 即使失败也更新进度
    if (typeof progressCallback === 'function') {
      const progress = 30 + Math.floor(((processedCount + textBatch.length) / totalElements) * 55);
      progressCallback(progress, `已翻译 ${processedCount + textBatch.length}/${totalElements} 个元素（使用离线翻译）...`);
    }
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
 * @param {string} epubPath - 输入EPUB文件路径
 * @param {string} outputPdfPath - 输出PDF文件路径
 * @param {Function} progressCallback - 进度回调函数
 * @param {Object} options - 其他选项
 * @returns {Promise<string>} - 转换后的PDF文件路径
 */
async function convertEpubToPdf(epubPath, outputPdfPath, progressCallback = null, options = {}) {
  try {
    console.log(`开始将EPUB转换为PDF: ${epubPath} -> ${outputPdfPath}`);
    const startTime = Date.now();
    
    // 创建临时目录
    const tempDir = path.dirname(outputPdfPath);
    await fs.mkdir(tempDir, { recursive: true });
    
    // 1. 预处理EPUB文件
    if (typeof progressCallback === 'function') progressCallback(5, '预处理EPUB文件...');
    console.log('1. 预处理EPUB文件...');
    await preprocessEpub(epubPath, tempDir);
    
    // 2. 解析EPUB内容
    if (typeof progressCallback === 'function') progressCallback(10, '解析EPUB内容...');
    console.log('2. 解析EPUB内容...');
    let epubContent = await parseEpub(epubPath, tempDir, progressCallback);
    
    if (!epubContent) {
      console.error('解析EPUB失败，尝试直接提取');
      await extractEpubDirectly(epubPath, path.join(tempDir, 'extracted'));
      
      // 重新尝试查找文件
      const extractDir = path.join(tempDir, 'extracted');
      const htmlFiles = [];
      const cssFiles = [];
      const imageFiles = [];
      await findFiles(extractDir, htmlFiles, cssFiles, imageFiles, extractDir);
      
      epubContent = {
        title: path.basename(epubPath, '.epub'),
        htmlFiles: htmlFiles,
        cssFiles: cssFiles,
        imageFiles: imageFiles,
        tocItems: []
      };
    }
    
    // 3. 创建合并的HTML文件
    if (typeof progressCallback === 'function') progressCallback(50, '创建合并HTML文件...');
    console.log('3. 创建合并HTML文件...');
    const consolidatedHtmlPath = path.join(tempDir, 'consolidated.html');
    
    await createConsolidatedHtml(
      epubContent.htmlFiles, 
      epubContent.cssFiles, 
      epubContent.imageFiles, 
      epubContent.tocItems, 
      tempDir
    );
    
    console.log(`已创建合并HTML: ${consolidatedHtmlPath}`);
    
    // 新增：创建两个版本的输出文件
    const originalPdfPath = outputPdfPath; // 原文PDF路径保持不变
    const translationTxtPath = outputPdfPath.replace('.pdf', '_translation.txt'); // 翻译文件路径
    
    if (typeof progressCallback === 'function') progressCallback(65, '开始提取需要翻译的内容...');
    
    const htmlContent = await fs.readFile(consolidatedHtmlPath, 'utf8');
    const translationMethod = TRANSLATOR_API.toUpperCase();
    
    try {
      // 4. 生成原文PDF
      if (typeof progressCallback === 'function') progressCallback(70, '生成原文PDF...');
      console.log('4. 生成原文PDF...');
      await convertHtmlToPdf(
        consolidatedHtmlPath, 
        originalPdfPath, 
        (progress, message) => {
          if (typeof progressCallback === 'function') {
            // PDF生成阶段占70%-85%的进度
            const overallProgress = 70 + Math.floor(progress * 15);
            progressCallback(overallProgress, message);
          }
        }
      );
      
      // 5. 生成单独的翻译文件
      if (typeof progressCallback === 'function') progressCallback(85, '创建翻译文件...');
      console.log('5. 创建翻译文件...');
      
      // 提取需要翻译的文本内容
      const $ = cheerio.load(htmlContent);
      
      // 按章节组织翻译内容
      let translationContent = `======== 《${epubContent.title || path.basename(epubPath, '.epub')}》翻译文本 ========\n\n`;
      translationContent += `生成时间: ${new Date().toLocaleString()}\n\n`;
      translationContent += `=========================\n\n`;
      
      // 生成目录部分
      if (epubContent.tocItems && epubContent.tocItems.length > 0) {
        translationContent += `## 目录\n\n`;
        for (const tocItem of epubContent.tocItems) {
          const indent = '  '.repeat(tocItem.level || 0);
          translationContent += `${indent}- ${tocItem.title}\n`;
        }
        translationContent += `\n=========================\n\n`;
      }
      
      // 按章节提取和翻译内容 - 新的高效方法
      console.log(`使用章节级批量处理方法生成翻译`);
      
      // 查找所有章节容器
      const chapters = $('body > div, body > section, .chapter, [id^="chapter"], [class*="chapter"]');
      console.log(`找到 ${chapters.length} 个潜在章节容器`);
      
      if (chapters.length === 0) {
        // 如果没有找到明确的章节，尝试按顺序处理所有标题
        await generateTranslationByHeadings($, translationMethod, translationContent, translationTxtPath, progressCallback);
      } else {
        // 处理每个章节
        let processedChapters = 0;
        const totalChapters = chapters.length;
        
        for (let i = 0; i < chapters.length; i++) {
          const chapter = chapters.eq(i);
          // 获取章节标题
          const headingElement = chapter.find('h1, h2, h3').first();
          const chapterTitle = headingElement.text().trim() || `章节 ${i+1}`;
          
          // 更新进度
          if (typeof progressCallback === 'function') {
            const progress = 85 + Math.floor((processedChapters / totalChapters) * 10);
            progressCallback(progress, `处理章节 ${processedChapters+1}/${totalChapters}: ${chapterTitle}`);
          }
          
          console.log(`处理章节: ${chapterTitle}`);
          
          // 获取章节中所有可翻译元素
          const elementsToTranslate = chapter.find('h1, h2, h3, h4, h5, h6, p, li').filter(function() {
            const text = $(this).text().trim();
            return text.length > 0 && /[a-zA-Z]{5,}/.test(text);
          });
          
          if (elementsToTranslate.length === 0) {
            console.log(`章节 "${chapterTitle}" 中没有找到需要翻译的内容`);
            continue;
          }
          
          // 章节标题单独处理
          let translatedTitle = '';
          try {
            translatedTitle = await translateText(chapterTitle, 0);
            translatedTitle = translatedTitle.split('\n【原文】')[0]; // 只获取翻译部分
          } catch (err) {
            console.error(`章节标题翻译失败: ${err.message}`);
            translatedTitle = simulateTranslation(chapterTitle).split('\n【原文】')[0];
          }
          
          // 添加章节标题到翻译内容
          translationContent += `## ${translatedTitle}\n\n`;
          
          // 合并本章节所有文本以批量翻译
          let chapterTexts = [];
          const seenElements = new Set(); // 用于跟踪已处理的元素
          
          elementsToTranslate.each(function() {
            const $element = $(this);
            const text = $element.text().trim();
            
            // 确保元素文本非空、不是标题、未被处理过
            if (text && text !== chapterTitle && text.length > 0) {
              // 对于目录页面，可能有很多相同的链接文本，需要检查文本是否已包含
              if (!seenElements.has(text)) {
                seenElements.add(text);
                chapterTexts.push(text);
              } else {
                console.log(`跳过重复文本: ${text.substring(0, 30)}${text.length > 30 ? '...' : ''}`);
              }
            }
          });
          
          // 过滤重复文本，避免浪费API请求
          const uniqueTexts = [...new Set(chapterTexts)];
          console.log(`章节 "${chapterTitle}" 原始文本：${chapterTexts.length}个，去重后：${uniqueTexts.length}个`);
          
          if (uniqueTexts.length === 0) {
            console.log(`章节 "${chapterTitle}" 没有需要翻译的唯一内容，跳过`);
            continue;
          }
          
          // 将章节文本分成适当大小的批次
          const batchSize = 5; // 每批处理的文本数量
          for (let j = 0; j < uniqueTexts.length; j += batchSize) {
            const textBatch = uniqueTexts.slice(j, j + batchSize);
            
            // 使用不容易出现在正常文本中的随机生成分隔符
            const timestamp = Date.now();
            const randomString = Math.random().toString(36).substring(2, 10);
            const SEPARATOR = `\n##--SPLIT_MARK_${timestamp}_${randomString}--##\n`;
            
            // 合并批次文本
            const combinedText = textBatch.join(SEPARATOR);
            if (combinedText.length === 0) continue;
            
            console.log(`批量翻译章节 "${chapterTitle}" 的第 ${Math.floor(j/batchSize) + 1}/${Math.ceil(uniqueTexts.length/batchSize)} 批内容，共 ${combinedText.length} 个字符`);
            console.log(`批次内容：${textBatch.slice(0, 2).map(t => t.substring(0, 30) + '...').join(', ')}${textBatch.length > 2 ? '...' : ''}`);
            
            try {
              // 批量翻译文本
              const translatedCombined = await translateText(combinedText, 0);
              const translatedParts = translatedCombined.split(SEPARATOR);
              
              // 验证翻译结果
              if (translatedParts.length === textBatch.length) {
                // 处理每个翻译结果，添加到章节内容
                for (let k = 0; k < translatedParts.length; k++) {
                  const translatedText = translatedParts[k].trim();
                  // 从翻译结果中提取翻译部分（去除"原文"部分）
                  const translatedOnly = translatedText.split('\n【原文】')[0];
                  translationContent += `${translatedOnly}\n\n`;
                }
              } else {
                console.warn(`翻译结果拆分不匹配: 批次 ${j/batchSize + 1}，期望 ${textBatch.length} 个部分，实际得到 ${translatedParts.length} 个部分`);
                
                // 逐个翻译
                for (const text of textBatch) {
                  try {
                    const translatedText = await translateText(text, 0);
                    const translatedOnly = translatedText.split('\n【原文】')[0];
                    translationContent += `${translatedOnly}\n\n`;
                  } catch (singleError) {
                    console.warn(`单独翻译失败: ${singleError.message}`);
                    const simText = simulateTranslation(text).split('\n【原文】')[0];
                    translationContent += `${simText}\n\n`;
                  }
                  
                  // 短暂延迟避免API限制
                  await new Promise(resolve => setTimeout(resolve, 1000));
                }
              }
            } catch (batchError) {
              console.error(`批量翻译失败: ${batchError.message}`);
              
              // 逐个翻译
              for (const text of textBatch) {
                try {
                  const translatedText = await translateText(text, 0);
                  const translatedOnly = translatedText.split('\n【原文】')[0];
                  translationContent += `${translatedOnly}\n\n`;
                } catch (singleError) {
                  console.warn(`单独翻译失败: ${singleError.message}`);
                  const simText = simulateTranslation(text).split('\n【原文】')[0];
                  translationContent += `${simText}\n\n`;
                }
                
                // 短暂延迟避免API限制
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
            }
            
            // 批次之间添加延迟
            if (j + batchSize < uniqueTexts.length) {
              const batchWaitTime = Math.max(TRANSLATE_DELAY/3, 1000);
              console.log(`批次间等待 ${batchWaitTime}ms...`);
              await new Promise(resolve => setTimeout(resolve, batchWaitTime));
            }
          }
          
          // 章节末尾添加分隔线
          translationContent += `\n---\n\n`;
          processedChapters++;
          
          // 章节之间添加延迟
          if (i < chapters.length - 1) {
            await new Promise(resolve => setTimeout(resolve, TRANSLATE_DELAY / 2));
          }
          
          // 每10个章节保存一次进度，避免任务被终止丢失所有翻译
          if (processedChapters % 10 === 0 || processedChapters === totalChapters) {
            await fs.writeFile(translationTxtPath, translationContent);
            console.log(`已保存翻译进度 (章节 ${processedChapters}/${totalChapters})`);
          }
        }
      }
      
      // 保存最终翻译文件
      await fs.writeFile(translationTxtPath, translationContent);
      console.log(`翻译文件已保存: ${translationTxtPath}`);
      
      if (typeof progressCallback === 'function') progressCallback(95, '翻译文件已创建');
      
      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;
      console.log(`转换完成，用时 ${duration.toFixed(2)} 秒`);
      
      // 清理临时文件
      console.log('清理临时文件...');
      
      // 返回结果包含两个文件路径
      return {
        originalPdfPath,
        translationTxtPath
      };
    } catch (convertError) {
      console.error(`转换失败: ${convertError.message}`);
      throw convertError;
    }
  } catch (error) {
    console.error(`EPUB转换为PDF失败: ${error.message}`);
    throw error;
  }
}

/**
 * 备用翻译方法 - 简化版，更少API调用
 * 仅翻译重要元素且避免频繁API请求
 * @param {string} html - HTML内容
 * @param {function} progressCallback - 进度回调函数
 * @returns {Promise<string>} - 翻译后的HTML
 */
async function fallbackTranslateHtml(html, progressCallback = null) {
  try {
    const $ = cheerio.load(html);
    console.log('使用备用翻译方法处理HTML...');
    
    // 通知进度
    if (typeof progressCallback === 'function') {
      progressCallback(30, '使用备用翻译方法处理HTML...');
    }
    
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
    
    // 更新进度
    if (typeof progressCallback === 'function') {
      progressCallback(35, '标题翻译完成，开始处理主要标题...');
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
          
          // 使用更好的双语格式
          if (translatedText.includes('【原文】')) {
            // 已经包含原文的情况
            h.html(translatedText.replace('\n【原文】', '<br><span style="font-size:0.9em;color:#666">【原文】') + '</span>');
          } else {
            // 添加原文作为参考
            h.html(`${translatedText}<br><span style="font-size:0.9em;color:#666">【原文】${text}</span>`);
          }
          
          // 更新进度
          if (typeof progressCallback === 'function') {
            const progress = 35 + Math.floor((i / mainHeadings.length) * 15);
            progressCallback(progress, `已翻译 ${i+1}/${mainHeadings.length} 个主要标题...`);
          }
          
          // 每个标题添加较长延迟
          await new Promise(resolve => setTimeout(resolve, 10000));
        } catch (hError) {
          console.error(`标题翻译失败，跳过: ${hError.message}`);
          continue;
        }
      }
    }
    
    // 更新进度
    if (typeof progressCallback === 'function') {
      progressCallback(50, '主要标题翻译完成，开始处理关键段落...');
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
        
        // 使用更好的双语格式显示
        if (translatedText.includes('【原文】')) {
          // 已经包含原文的情况
          p.html(translatedText.replace('\n【原文】', '<br><span style="font-size:0.9em;color:#666">【原文】') + '</span>');
        } else {
          // 添加原文作为参考，使用HTML格式使其更易阅读
          p.html(`${translatedText}<br><span style="font-size:0.9em;color:#666">【原文】${text}</span>`);
        }
        
        // 更新进度
        if (typeof progressCallback === 'function') {
          const progress = 50 + Math.floor((i / significantParagraphs.length) * 35);
          progressCallback(progress, `已翻译 ${i+1}/${significantParagraphs.length} 个关键段落...`);
        }
        
        // 添加长延迟
        await new Promise(resolve => setTimeout(resolve, 15000));
      } catch (pError) {
        console.error(`段落翻译失败: ${pError.message}`);
        continue;
      }
    }
    
    console.log('备用翻译方法完成，已翻译部分重要内容');
    
    // 最终进度更新
    if (typeof progressCallback === 'function') {
      progressCallback(85, '备用翻译完成，准备生成PDF...');
    }
    
    return $.html();
  } catch (error) {
    console.error(`备用翻译失败: ${error.message}`);
    
    // 失败时也要通知进度
    if (typeof progressCallback === 'function') {
      progressCallback(50, `备用翻译失败: ${error.message}`);
    }
    
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
 * @param {Array} htmlFiles - HTML文件列表
 * @param {Array} cssFiles - CSS文件列表
 * @param {Array} imageFiles - 图片文件列表
 * @param {Array} tocItems - 目录项列表
 * @param {string} tempDir - 临时目录
 * @returns {Promise<string>} - 合并后的HTML文件路径
 */
async function createConsolidatedHtml(htmlFiles, cssFiles, imageFiles, tocItems, tempDir) {
  try {
    console.log('创建合并HTML文件...');
    
    // 详细的输入验证和调试信息
    if (!Array.isArray(htmlFiles)) {
      console.error(`htmlFiles不是数组: ${typeof htmlFiles}`);
      throw new Error('HTML文件列表格式无效');
    }
    
    if (htmlFiles.length === 0) {
      console.error('HTML文件列表为空');
      throw new Error('无有效的HTML文件可合并');
    }
    
    console.log(`准备合并 ${htmlFiles.length} 个HTML文件`);
    
    // 验证每个HTML文件的路径是否有效
    let validHtmlFiles = 0;
    for (const htmlFile of htmlFiles) {
      if (!htmlFile || !htmlFile.path) {
        console.warn('发现无效的HTML文件对象(缺少path属性)');
        continue;
      }
      
      if (!fs.existsSync(htmlFile.path)) {
        console.warn(`HTML文件不存在: ${htmlFile.path}`);
        continue;
      }
      
      validHtmlFiles++;
    }
    
    console.log(`验证后有效的HTML文件数量: ${validHtmlFiles}`);
    
    if (validHtmlFiles === 0) {
      throw new Error('所有HTML文件路径无效，无法创建合并文件');
    }
    
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
    if (Array.isArray(cssFiles) && cssFiles.length > 0) {
      console.log(`添加 ${cssFiles.length} 个CSS文件到HTML中`);
      
      for (const cssFile of cssFiles) {
        try {
          if (cssFile && cssFile.path && fs.existsSync(cssFile.path)) {
            let cssContent = await fs.readFile(cssFile.path, 'utf8');
            // 修复CSS中的相对路径
            cssContent = fixCssRelativePaths(cssContent, cssFile.href || '');
            htmlContent += `<style>${cssContent}</style>`;
          } else {
            console.warn(`跳过无效的CSS文件: ${cssFile?.path || '未知'}`);
          }
        } catch (error) {
          console.warn(`添加CSS文件失败 (${cssFile?.path || '未知'}): ${error.message}`);
        }
      }
    } else {
      console.log('没有CSS文件需要添加');
    }
    
    // 完成头部
    htmlContent += `
      </head>
      <body>
    `;
    
    // 添加标题和目录
    if (Array.isArray(tocItems) && tocItems.length > 0) {
      console.log(`添加 ${tocItems.length} 个目录项`);
      htmlContent += `
        <div class="toc">
          <h2>目录</h2>
          <ul>
      `;
      
      for (let i = 0; i < tocItems.length; i++) {
        const title = tocItems[i]?.title || `章节 ${i+1}`;
        htmlContent += `<li><a href="#chapter-${i}">${title}</a></li>`;
      }
      
      htmlContent += `
          </ul>
        </div>
      `;
    } else {
      console.log('没有目录项，跳过目录生成');
    }
    
    // 添加章节内容
    let addedChapters = 0;
    for (let i = 0; i < htmlFiles.length; i++) {
      try {
        const htmlFile = htmlFiles[i];
        if (!htmlFile || !htmlFile.path) {
          console.warn(`第 ${i+1} 个HTML文件对象无效`);
          continue;
        }
        
        if (!fs.existsSync(htmlFile.path)) {
          console.warn(`HTML文件不存在: ${htmlFile.path}`);
          continue;
        }
        
        console.log(`处理章节 ${i+1}/${htmlFiles.length}: ${path.basename(htmlFile.path)}`);
        
        // 读取HTML文件内容
        let chapterContent = await fs.readFile(htmlFile.path, 'utf8');
        
        // 修复章节中的相对路径
        chapterContent = fixHtmlRelativePaths(chapterContent, htmlFile.href || '', imageFiles || []);
        
        // 提取HTML内容主体部分
        const bodyContent = extractBodyContent(chapterContent);
        
        if (!bodyContent || bodyContent.trim() === '') {
          console.warn(`章节 ${i+1} 内容为空，跳过`);
          continue;
        }
        
        // 添加章节标题和内容
        const title = (tocItems && tocItems[i]?.title) || `章节 ${i+1}`;
        
        htmlContent += `
          <div class="chapter" id="chapter-${i}">
            <h1>${title}</h1>
            ${bodyContent}
          </div>
        `;
        
        addedChapters++;
      } catch (error) {
        console.warn(`处理章节 ${i+1} 内容失败: ${error.message}`);
      }
    }
    
    console.log(`成功添加了 ${addedChapters} 个章节`);
    
    if (addedChapters === 0) {
      throw new Error('无法提取任何章节内容，请检查HTML文件格式');
    }
    
    // 结束HTML
    htmlContent += `
      </body>
      </html>
    `;
    
    // 写入合并的HTML文件
    const outputPath = path.join(tempDir, 'consolidated.html');
    await fs.writeFile(outputPath, htmlContent, 'utf8');
    
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

/**
 * 按照标题分段生成翻译文件
 * @param {CheerioStatic} $ - Cheerio对象
 * @param {string} translationMethod - 翻译方法
 * @param {string} translationContent - 当前翻译内容
 * @param {string} translationTxtPath - 翻译文件保存路径
 * @param {function} progressCallback - 进度回调函数
 */
async function generateTranslationByHeadings($, translationMethod, translationContent, translationTxtPath, progressCallback) {
  console.log('使用标题分割章节生成翻译');
  
  // 查找所有标题元素
  const headings = $('h1, h2, h3, h4');
  console.log(`找到 ${headings.length} 个标题元素作为分段点`);
  
  if (headings.length === 0) {
    // 如果没有找到标题，使用原始方法
    console.log('没有找到标题元素，使用原始元素处理方法');
    await generateTranslationByElements($, translationMethod, translationContent, translationTxtPath, progressCallback);
    return;
  }
  
  // 处理每个标题和其下内容
  let processedHeadings = 0;
  const totalHeadings = headings.length;
  
  for (let i = 0; i < headings.length; i++) {
    const heading = headings.eq(i);
    const headingText = heading.text().trim();
    
    // 更新进度
    if (typeof progressCallback === 'function') {
      const progress = 85 + Math.floor((processedHeadings / totalHeadings) * 10);
      progressCallback(progress, `处理部分 ${processedHeadings+1}/${totalHeadings}: ${headingText}`);
    }
    
    // 翻译标题
    let translatedHeading = '';
    try {
      translatedHeading = await translateText(headingText, 0);
      translatedHeading = translatedHeading.split('\n【原文】')[0]; // 只获取翻译部分
    } catch (err) {
      console.error(`标题翻译失败: ${err.message}`);
      translatedHeading = simulateTranslation(headingText).split('\n【原文】')[0];
    }
    
    // 添加标题到翻译内容
    translationContent += `## ${translatedHeading}\n\n`;
    
    // 收集标题下的内容元素
    const contentElements = [];
    let elem = heading;
    while (elem.next().length && !elem.next().is('h1, h2, h3, h4')) {
      elem = elem.next();
      if (elem.is('p, li') && elem.text().trim().length > 0) {
        contentElements.push(elem);
      }
    }
    
    console.log(`标题 "${headingText}" 下找到 ${contentElements.length} 个内容元素`);
    
    // 批量翻译内容元素
    if (contentElements.length > 0) {
      const batchSize = 5;
      let contentTexts = [];
      const seenElements = new Set(); // 用于跟踪已处理的元素
      
      contentElements.forEach(element => {
        const text = $(element).text().trim();
        if (text.length > 0) {
          // 检查是否处理过相同文本
          if (!seenElements.has(text)) {
            seenElements.add(text);
            contentTexts.push(text);
          } else {
            console.log(`跳过重复文本: ${text.substring(0, 30)}${text.length > 30 ? '...' : ''}`);
          }
        }
      });
      
      // 过滤重复文本，避免浪费API请求
      const uniqueTexts = [...new Set(contentTexts)];
      console.log(`标题 "${headingText}" 下原始文本：${contentTexts.length}个，去重后：${uniqueTexts.length}个`);
      
      if (uniqueTexts.length === 0) {
        console.log(`标题 "${headingText}" 下没有需要翻译的唯一内容，跳过`);
        continue;
      }
      
      // 分批翻译内容
      for (let j = 0; j < uniqueTexts.length; j += batchSize) {
        const textBatch = uniqueTexts.slice(j, j + batchSize);
        
        // 使用独特分隔符
        const timestamp = Date.now();
        const randomString = Math.random().toString(36).substring(2, 10);
        const SEPARATOR = `\n##--SPLIT_MARK_${timestamp}_${randomString}--##\n`;
        
        const combinedText = textBatch.join(SEPARATOR);
        if (combinedText.length === 0) continue;
        
        console.log(`批量翻译 "${headingText}" 的第 ${j/batchSize + 1} 批内容，共 ${combinedText.length} 个字符`);
        console.log(`批次内容：${textBatch.slice(0, 2).map(t => t.substring(0, 30) + '...').join(', ')}${textBatch.length > 2 ? '...' : ''}`);
        
        try {
          const translatedCombined = await translateText(combinedText, 0);
          const translatedParts = translatedCombined.split(SEPARATOR);
          
          if (translatedParts.length === textBatch.length) {
            for (let k = 0; k < translatedParts.length; k++) {
              const translatedText = translatedParts[k].trim();
              const translatedOnly = translatedText.split('\n【原文】')[0];
              translationContent += `${translatedOnly}\n\n`;
            }
          } else {
            console.warn(`翻译结果拆分不匹配，逐个处理`);
            
            for (const text of textBatch) {
              try {
                const translatedText = await translateText(text, 0);
                const translatedOnly = translatedText.split('\n【原文】')[0];
                translationContent += `${translatedOnly}\n\n`;
              } catch (singleError) {
                console.warn(`单独翻译失败: ${singleError.message}`);
                const simText = simulateTranslation(text).split('\n【原文】')[0];
                translationContent += `${simText}\n\n`;
              }
              
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }
        } catch (batchError) {
          console.error(`批量翻译失败: ${batchError.message}`);
          
          for (const text of textBatch) {
            try {
              const translatedText = await translateText(text, 0);
              const translatedOnly = translatedText.split('\n【原文】')[0];
              translationContent += `${translatedOnly}\n\n`;
            } catch (singleError) {
              console.warn(`单独翻译失败: ${singleError.message}`);
              const simText = simulateTranslation(text).split('\n【原文】')[0];
              translationContent += `${simText}\n\n`;
            }
            
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
        
        // 批次之间添加延迟
        if (j + batchSize < uniqueTexts.length) {
          const batchWaitTime = Math.max(TRANSLATE_DELAY/3, 1000);
          console.log(`批次间等待 ${batchWaitTime}ms...`);
          await new Promise(resolve => setTimeout(resolve, batchWaitTime));
        }
      }
    }
    
    // 章节末尾添加分隔线
    translationContent += `\n---\n\n`;
    processedHeadings++;
    
    // 章节之间添加延迟
    if (i < headings.length - 1) {
      await new Promise(resolve => setTimeout(resolve, TRANSLATE_DELAY / 2));
    }
    
    // 每10个标题保存一次进度
    if (processedHeadings % 10 === 0 || processedHeadings === totalHeadings) {
      await fs.writeFile(translationTxtPath, translationContent);
      console.log(`已保存翻译进度 (标题 ${processedHeadings}/${totalHeadings})`);
    }
  }
  
  // 保存最终翻译文件
  await fs.writeFile(translationTxtPath, translationContent);
}

/**
 * 按元素逐个生成翻译文件 (原方法，作为最后的备选)
 * @param {CheerioStatic} $ - Cheerio对象
 * @param {string} translationMethod - 翻译方法
 * @param {string} translationContent - 当前翻译内容
 * @param {string} translationTxtPath - 翻译文件保存路径
 * @param {function} progressCallback - 进度回调函数
 */
async function generateTranslationByElements($, translationMethod, translationContent, translationTxtPath, progressCallback) {
  console.log('使用元素级处理方法生成翻译');
  
  // 提取所有需要翻译的元素
  const elementsToTranslate = $('h1, h2, h3, h4, h5, h6, p, li').filter(function() {
    const text = $(this).text().trim();
    return text.length > 0 && /[a-zA-Z]{5,}/.test(text);
  }).toArray();
  
  console.log(`找到 ${elementsToTranslate.length} 个需要翻译的元素`);
  let currentHeading = '开始章节';
  let currentSection = '';
  let elementsProcessed = 0;
  
  // 将元素分批处理
  const batchSize = 5;
  for (let i = 0; i < elementsToTranslate.length; i += batchSize) {
    const elementBatch = elementsToTranslate.slice(i, Math.min(i + batchSize, elementsToTranslate.length));
    
    // 更新进度
    if (typeof progressCallback === 'function') {
      const progress = 85 + Math.floor((i / elementsToTranslate.length) * 10);
      progressCallback(progress, `处理元素 ${i+1}/${elementsToTranslate.length}...`);
    }
    
    // 收集批次文本
    const textBatch = [];
    const elementInfo = [];
    
    for (const element of elementBatch) {
      const $element = $(element);
      const tagName = element.tagName.toLowerCase();
      const text = $element.text().trim();
      
      if (text.length === 0) continue;
      
      textBatch.push(text);
      elementInfo.push({ tagName, text });
    }
    
    // 过滤重复文本，避免浪费API请求
    const uniqueBatch = [];
    const uniqueInfo = [];
    const seenTexts = new Set();
    
    for (let i = 0; i < textBatch.length; i++) {
      if (!seenTexts.has(textBatch[i])) {
        seenTexts.add(textBatch[i]);
        uniqueBatch.push(textBatch[i]);
        uniqueInfo.push(elementInfo[i]);
      }
    }
    
    console.log(`批次原始文本：${textBatch.length}个，去重后：${uniqueBatch.length}个`);
    
    if (uniqueBatch.length === 0) {
      console.log(`批次没有需要翻译的唯一内容，跳过`);
      continue;
    }
    
    // 使用分隔符合并文本
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 10);
    const SEPARATOR = `\n##--SPLIT_MARK_${timestamp}_${randomString}--##\n`;
    
    const combinedText = uniqueBatch.join(SEPARATOR);
    if (combinedText.length === 0) continue;
    
    console.log(`批量翻译第 ${Math.floor(i/batchSize) + 1}/${Math.ceil(elementsToTranslate.length/batchSize)} 批元素，共 ${combinedText.length} 个字符`);
    console.log(`批次内容：${uniqueBatch.slice(0, 2).map(t => t.substring(0, 30) + '...').join(', ')}${uniqueBatch.length > 2 ? '...' : ''}`);
    
    try {
      // 批量翻译
      const translatedCombined = await translateText(combinedText, 0);
      const translatedParts = translatedCombined.split(SEPARATOR);
      
      if (translatedParts.length === uniqueBatch.length) {
        // 处理翻译结果
        for (let j = 0; j < uniqueInfo.length; j++) {
          const { tagName, text } = uniqueInfo[j];
          const translatedText = translatedParts[j].trim();
          const translatedOnly = translatedText.split('\n【原文】')[0];
          
          // 处理标题元素
          if (/^h[1-4]$/.test(tagName)) {
            // 保存上一节内容
            if (currentSection.trim()) {
              translationContent += `### ${currentHeading}\n\n${currentSection}\n\n`;
            }
            
            // 开始新章节
            currentHeading = text;
            currentSection = '';
            
            // 添加章节标题
            translationContent += `## ${translatedOnly}\n\n`;
          } else {
            // 添加到当前章节内容
            currentSection += `${translatedOnly}\n\n`;
          }
        }
      } else {
        console.warn(`翻译结果拆分不匹配，逐个处理元素`);
        
        // 逐个处理元素
        for (const { tagName, text } of uniqueInfo) {
          try {
            const translatedText = await translateText(text, 0);
            const translatedOnly = translatedText.split('\n【原文】')[0];
            
            // 处理标题元素
            if (/^h[1-4]$/.test(tagName)) {
              // 保存上一节内容
              if (currentSection.trim()) {
                translationContent += `### ${currentHeading}\n\n${currentSection}\n\n`;
              }
              
              // 开始新章节
              currentHeading = text;
              currentSection = '';
              
              // 添加章节标题
              translationContent += `## ${translatedOnly}\n\n`;
            } else {
              // 添加到当前章节内容
              currentSection += `${translatedOnly}\n\n`;
            }
          } catch (singleError) {
            console.warn(`单独翻译元素失败: ${singleError.message}`);
            const simText = simulateTranslation(text).split('\n【原文】')[0];
            
            if (/^h[1-4]$/.test(tagName)) {
              if (currentSection.trim()) {
                translationContent += `### ${currentHeading}\n\n${currentSection}\n\n`;
              }
              currentHeading = text;
              currentSection = '';
              translationContent += `## ${simText}\n\n`;
            } else {
              currentSection += `${simText}\n\n`;
            }
          }
          
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    } catch (batchError) {
      console.error(`批量翻译失败: ${batchError.message}`);
      
      // 逐个处理元素
      for (const { tagName, text } of uniqueInfo) {
        try {
          const translatedText = await translateText(text, 0);
          const translatedOnly = translatedText.split('\n【原文】')[0];
          
          if (/^h[1-4]$/.test(tagName)) {
            if (currentSection.trim()) {
              translationContent += `### ${currentHeading}\n\n${currentSection}\n\n`;
            }
            currentHeading = text;
            currentSection = '';
            translationContent += `## ${translatedOnly}\n\n`;
          } else {
            currentSection += `${translatedOnly}\n\n`;
          }
        } catch (singleError) {
          console.warn(`单独翻译元素失败: ${singleError.message}`);
          const simText = simulateTranslation(text).split('\n【原文】')[0];
          
          if (/^h[1-4]$/.test(tagName)) {
            if (currentSection.trim()) {
              translationContent += `### ${currentHeading}\n\n${currentSection}\n\n`;
            }
            currentHeading = text;
            currentSection = '';
            translationContent += `## ${simText}\n\n`;
          } else {
            currentSection += `${simText}\n\n`;
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // 批次之间添加延迟
    if (i + batchSize < elementsToTranslate.length) {
      const batchWaitTime = Math.max(TRANSLATE_DELAY/3, 1000);
      console.log(`批次间等待 ${batchWaitTime}ms...`);
      await new Promise(resolve => setTimeout(resolve, batchWaitTime));
    }
    
    // 每50个元素保存一次进度
    elementsProcessed += elementBatch.length;
    if (elementsProcessed % 50 === 0 || elementsProcessed >= elementsToTranslate.length) {
      // 保存最后一节
      if (currentSection.trim()) {
        translationContent += `### ${currentHeading}\n\n${currentSection}\n\n`;
        currentSection = '';
      }
      
      await fs.writeFile(translationTxtPath, translationContent);
      console.log(`已保存翻译进度 (元素 ${elementsProcessed}/${elementsToTranslate.length})`);
    }
  }
  
  // 保存最后一节内容
  if (currentSection.trim()) {
    translationContent += `### ${currentHeading}\n\n${currentSection}\n\n`;
  }
  
  // 保存最终翻译文件
  await fs.writeFile(translationTxtPath, translationContent);
}

/**
 * 从PDF文件中提取文本内容
 * @param {string} pdfPath - PDF文件路径
 * @param {function} progressCallback - 进度回调函数
 * @returns {Promise<string>} - 提取的文本内容
 */
async function extractTextFromPdf(pdfPath, progressCallback = null) {
  try {
    if (typeof progressCallback === 'function') {
      progressCallback(10, '加载PDF文件...');
    }
    
    // 使用pdf-parse库来提取PDF文本
    const fs = require('fs').promises;
    const pdf = require('pdf-parse');
    
    // 读取PDF文件
    const dataBuffer = await fs.readFile(pdfPath);
    
    if (typeof progressCallback === 'function') {
      progressCallback(30, '开始解析PDF内容...');
    }

    // 解析PDF内容
    const data = await pdf(dataBuffer, {
      // 自定义渲染页面文本的函数
      pagerender: function(pageData) {
        return pageData.getTextContent({ normalizeWhitespace: true })
          .then(function(textContent) {
            let lastY, text = '';
            for (let item of textContent.items) {
              if (lastY == item.transform[5] || !lastY) {
                text += item.str;
              } else {
                text += '\n' + item.str;
              }
              lastY = item.transform[5];
            }
            return text;
          });
      }
    });
    
    if (typeof progressCallback === 'function') {
      progressCallback(70, '清理和格式化文本...');
    }
    
    // 清理提取的文本
    let extractedText = data.text;
    
    // 按段落拆分，清理多余空白
    const paragraphs = extractedText
      .split(/\n\s*\n/)             // 按照空行分割成段落
      .filter(p => p.trim().length > 0)  // 过滤掉空段落
      .map(p => {
        return p.replace(/\s+/g, ' ').trim();  // 将多个空白字符替换为单个空格
      });
    
    // 重新组合为格式化文本
    const formattedText = paragraphs.join('\n\n');
    
    if (typeof progressCallback === 'function') {
      progressCallback(100, 'PDF文本提取完成');
    }
    
    return formattedText;
  } catch (error) {
    console.error(`PDF文本提取失败: ${error.message}`);
    if (typeof progressCallback === 'function') {
      progressCallback(0, `文本提取失败: ${error.message}`);
    }
    throw new Error(`无法从PDF提取文本: ${error.message}`);
  }
}

// 导出的函数
module.exports = {
  convertEpubToPdf,
  preprocessEpub,
  parseEpub,
  extractEpubDirectly,
  createConsolidatedHtml,
  convertHtmlToPdf,
  translateHtml,
  extractTextFromPdf,
  simulateTranslation,
  translateWithSiliconFlow,
  translateWithDeepSeek,
  translateWithGoogle
}; 