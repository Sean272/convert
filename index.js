#!/usr/bin/env node

/**
 * EPUB转PDF转换工具
 * 该工具可以将EPUB电子书文件转换为PDF格式，保持完整的文档结构和内容
 */

const fs = require('fs-extra');
const path = require('path');
const EPub = require('epub');
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const { program } = require('commander');
const ora = require('ora');

// 定义命令行参数
program
  .version('1.0.0')
  .description('将EPUB文件转换为PDF')
  .argument('<epubPath>', 'EPUB文件路径')
  .option('-o, --output <path>', '输出PDF文件路径')
  .option('-t, --temp <path>', '临时文件夹路径', './temp')
  .option('-k, --keep-temp', '保留临时文件', false)
  .parse(process.argv);

const options = program.opts();
const epubPath = program.args[0];

if (!epubPath) {
  console.error('请提供EPUB文件路径');
  process.exit(1);
}

const tempDir = options.temp;
const outputPath = options.output || path.join(process.cwd(), path.basename(epubPath, '.epub') + '.pdf');
const keepTemp = options.keepTemp;

/**
 * 主函数 - 转换EPUB到PDF
 */
async function convertEpubToPdf() {
  const spinner = ora('正在准备转换...').start();

  try {
    // 创建临时目录
    await fs.ensureDir(tempDir);
    spinner.text = '正在解析EPUB文件...';

    // 解析EPUB文件
    const book = await parseEpub(epubPath);
    spinner.text = '正在提取内容...';

    // 提取内容并生成HTML
    const { htmlFiles, cssFiles, imageFiles, tocItems } = await extractContent(book);
    spinner.text = '正在生成整合HTML...';
    
    // 创建包含所有章节的整合HTML
    const consolidatedHtmlPath = await createConsolidatedHtml(htmlFiles, cssFiles, imageFiles, tocItems);
    spinner.text = '正在生成PDF...';
    
    // 将HTML转换为PDF
    await convertHtmlToPdf(consolidatedHtmlPath, outputPath);
    
    // 清理临时文件
    if (!keepTemp) {
      spinner.text = '正在清理临时文件...';
      await fs.remove(tempDir);
    }
    
    spinner.succeed(`转换完成! PDF已保存到: ${outputPath}`);
  } catch (error) {
    spinner.fail(`转换失败: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

/**
 * 解析EPUB文件
 * @param {string} epubPath - EPUB文件路径
 * @returns {Promise<Object>} - 解析后的EPUB对象
 */
function parseEpub(epubPath) {
  return new Promise((resolve, reject) => {
    const epub = new EPub(epubPath);
    
    epub.on('error', reject);
    
    epub.on('end', () => {
      resolve(epub);
    });
    
    epub.parse();
  });
}

/**
 * 提取EPUB内容
 * @param {Object} book - 解析后的EPUB对象
 * @returns {Promise<Object>} - 提取的内容对象
 */
async function extractContent(book) {
  const htmlFiles = [];
  const cssFiles = new Map();
  const imageFiles = new Map();
  const tocItems = [];
  
  // 提取目录
  book.toc.forEach(toc => {
    tocItems.push({
      title: toc.title,
      href: toc.href
    });
  });
  
  // 提取章节内容
  for (let i = 0; i < book.flow.length; i++) {
    const item = book.flow[i];
    
    if (item.mediaType.includes('html') || item.mediaType.includes('xhtml')) {
      const content = await getChapterContent(book, item.id);
      const chapterPath = path.join(tempDir, `chapter_${i}.html`);
      await fs.writeFile(chapterPath, content);
      
      htmlFiles.push({
        id: item.id,
        path: chapterPath,
        href: item.href
      });
      
      // 解析HTML中的CSS和图片引用
      const $ = cheerio.load(content);
      
      // 提取CSS
      $('link[rel="stylesheet"]').each((_, el) => {
        const href = $(el).attr('href');
        if (href) {
          cssFiles.set(href, { id: href, href });
        }
      });
      
      // 提取图片
      $('img').each((_, el) => {
        const src = $(el).attr('src');
        if (src) {
          imageFiles.set(src, { id: src, href: src });
        }
      });
    }
  }
  
  // 提取CSS文件
  for (const [_, cssFile] of cssFiles) {
    try {
      const content = await getResourceContent(book, cssFile.href);
      const cssPath = path.join(tempDir, path.basename(cssFile.href));
      await fs.writeFile(cssPath, content);
      cssFile.path = cssPath;
    } catch (error) {
      console.warn(`警告: 无法提取CSS文件 ${cssFile.href}: ${error.message}`);
    }
  }
  
  // 提取图片文件
  for (const [_, imageFile] of imageFiles) {
    try {
      const content = await getResourceContent(book, imageFile.href);
      const imagePath = path.join(tempDir, path.basename(imageFile.href));
      await fs.writeFile(imagePath, content);
      imageFile.path = imagePath;
    } catch (error) {
      console.warn(`警告: 无法提取图片文件 ${imageFile.href}: ${error.message}`);
    }
  }
  
  return {
    htmlFiles,
    cssFiles: Array.from(cssFiles.values()),
    imageFiles: Array.from(imageFiles.values()),
    tocItems
  };
}

/**
 * 获取章节内容
 * @param {Object} book - EPUB对象
 * @param {string} chapterId - 章节ID
 * @returns {Promise<string>} - 章节内容
 */
function getChapterContent(book, chapterId) {
  return new Promise((resolve, reject) => {
    book.getChapter(chapterId, (error, text) => {
      if (error) {
        reject(error);
      } else {
        resolve(text);
      }
    });
  });
}

/**
 * 获取资源内容
 * @param {Object} book - EPUB对象
 * @param {string} resourcePath - 资源路径
 * @returns {Promise<Buffer|string>} - 资源内容
 */
function getResourceContent(book, resourcePath) {
  return new Promise((resolve, reject) => {
    book.getImage(resourcePath, (error, data, mimeType) => {
      if (error) {
        reject(error);
      } else {
        resolve(data);
      }
    });
  });
}

/**
 * 创建整合的HTML文件
 * @param {Array} htmlFiles - HTML文件列表
 * @param {Array} cssFiles - CSS文件列表 
 * @param {Array} imageFiles - 图片文件列表
 * @param {Array} tocItems - 目录项列表
 * @returns {Promise<string>} - 整合HTML文件路径
 */
async function createConsolidatedHtml(htmlFiles, cssFiles, imageFiles, tocItems) {
  const consolidatedHtmlPath = path.join(tempDir, 'consolidated.html');
  
  // 创建目录结构
  let tocHtml = '<div class="toc"><h1>目录</h1><ul>';
  tocItems.forEach((item, index) => {
    tocHtml += `<li><a href="#chapter-${index}">${item.title}</a></li>`;
  });
  tocHtml += '</ul></div>';
  
  // 内联CSS样式
  let cssContent = '';
  for (const cssFile of cssFiles) {
    if (cssFile.path) {
      const content = await fs.readFile(cssFile.path, 'utf-8');
      cssContent += content + '\n';
    }
  }
  
  // 添加自定义样式，确保中文正确显示
  cssContent += `
    @font-face {
      font-family: 'NotoSansSC';
      src: url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC&display=swap');
    }
    
    body {
      font-family: 'NotoSansSC', 'PingFang SC', 'Microsoft YaHei', sans-serif;
      margin: 0;
      padding: 0 2em;
      max-width: 900px;
      margin: 0 auto;
      line-height: 1.5;
    }
    
    .toc {
      margin-bottom: 2em;
      page-break-after: always;
    }
    
    .toc ul {
      padding-left: 2em;
    }
    
    .toc a {
      text-decoration: none;
      color: #000;
    }
    
    .chapter {
      page-break-before: always;
    }
    
    img {
      max-width: 100%;
      height: auto;
    }
  `;
  
  // 处理所有章节内容
  let chaptersHtml = '';
  for (let i = 0; i < htmlFiles.length; i++) {
    const htmlFile = htmlFiles[i];
    let content = await fs.readFile(htmlFile.path, 'utf-8');
    
    const $ = cheerio.load(content);
    
    // 处理图片路径
    $('img').each((_, el) => {
      const src = $(el).attr('src');
      if (src) {
        const imageFile = Array.from(imageFiles).find(img => img.href === src);
        if (imageFile && imageFile.path) {
          $(el).attr('src', imageFile.path);
        }
      }
    });
    
    // 获取body内容
    const bodyContent = $('body').html() || '';
    
    // 添加章节标识
    chaptersHtml += `<div id="chapter-${i}" class="chapter">${bodyContent}</div>`;
  }
  
  // 创建最终HTML文件
  const finalHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>转换后的电子书</title>
      <style>${cssContent}</style>
    </head>
    <body>
      ${tocHtml}
      ${chaptersHtml}
    </body>
    </html>
  `;
  
  await fs.writeFile(consolidatedHtmlPath, finalHtml);
  return consolidatedHtmlPath;
}

/**
 * 将HTML转换为PDF
 * @param {string} htmlPath - HTML文件路径
 * @param {string} outputPath - 输出PDF路径
 */
async function convertHtmlToPdf(htmlPath, outputPath) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    
    // 设置字体以支持中文
    await page.evaluateOnNewDocument(() => {
      document.documentElement.style.fontFamily = "'NotoSansSC', 'PingFang SC', 'Microsoft YaHei', sans-serif";
    });
    
    await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle0' });
    
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
  } finally {
    await browser.close();
  }
}

// 启动转换过程
convertEpubToPdf(); 