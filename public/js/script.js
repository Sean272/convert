/**
 * EPUB 转 PDF 工具 - 前端JavaScript
 * 处理文件上传、进度显示和下载功能
 */

document.addEventListener('DOMContentLoaded', () => {
  // 元素引用
  const uploadArea = document.getElementById('uploadArea');
  const fileInput = document.getElementById('fileInput');
  const conversionStatus = document.getElementById('conversionStatus');
  const fileName = document.getElementById('fileName');
  const progressBar = document.getElementById('progressBar');
  const statusMessage = document.getElementById('statusMessage');
  const cancelButton = document.getElementById('cancelButton');
  const downloadButton = document.getElementById('downloadButton');
  const translateOption = document.getElementById('translateOption');
  
  let currentTask = null;
  let statusCheckInterval = null;
  
  // 点击上传区域不应该触发翻译选项
  uploadArea.addEventListener('click', (e) => {
    // 如果点击的是翻译选项或其子元素，则不触发文件选择
    if (e.target.closest('.translation-option')) {
      return;
    }
    fileInput.click();
  });
  
  // 添加拖放事件处理
  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('dragover');
  });
  
  uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('dragover');
  });
  
  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    
    if (e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0]);
    }
  });
  
  // 文件选择处理
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      handleFile(fileInput.files[0]);
    }
  });
  
  // 取消按钮事件
  cancelButton.addEventListener('click', () => {
    clearInterval(statusCheckInterval);
    resetUI();
  });
  
  /**
   * 处理选择的文件
   * @param {File} file - 用户选择的文件
   */
  function handleFile(file) {
    // 检查文件类型
    const fileExt = file.name.split('.').pop().toLowerCase();
    if (fileExt !== 'epub') {
      alert('请选择 EPUB 格式的文件');
      return;
    }
    
    // 显示转换状态UI
    uploadArea.style.display = 'none';
    conversionStatus.style.display = 'block';
    fileName.textContent = file.name;
    
    // 上传文件
    uploadFile(file);
  }
  
  /**
   * 上传文件到服务器
   * @param {File} file - 要上传的文件
   */
  function uploadFile(file) {
    const formData = new FormData();
    formData.append('epubFile', file);
    
    // 添加翻译选项
    const shouldTranslate = translateOption.checked;
    formData.append('translate', shouldTranslate ? 'true' : 'false');
    
    progressBar.style.width = '0%';
    statusMessage.textContent = '正在上传文件...';
    
    fetch('/convert', {
      method: 'POST',
      body: formData
    })
    .then(response => {
      if (!response.ok) {
        throw new Error('上传失败');
      }
      return response.json();
    })
    .then(data => {
      currentTask = data.taskId;
      statusMessage.textContent = data.message;
      
      // 开始定期检查转换状态
      statusCheckInterval = setInterval(checkConversionStatus, 1000);
    })
    .catch(error => {
      statusMessage.textContent = `错误: ${error.message}`;
      progressBar.style.width = '0%';
    });
  }
  
  /**
   * 检查转换任务状态
   */
  function checkConversionStatus() {
    if (!currentTask) return;
    
    fetch(`/task/${currentTask}`)
      .then(response => {
        if (!response.ok) {
          throw new Error('获取状态失败');
        }
        return response.json();
      })
      .then(data => {
        // 更新进度条
        progressBar.style.width = `${data.progress}%`;
        statusMessage.textContent = data.message;
        
        // 检查任务是否完成
        if (data.status === 'completed') {
          clearInterval(statusCheckInterval);
          downloadButton.style.display = 'block';
          downloadButton.onclick = () => {
            window.location.href = data.outputPath;
          };
        } 
        // 检查任务是否失败
        else if (data.status === 'failed') {
          clearInterval(statusCheckInterval);
          statusMessage.textContent = `转换失败: ${data.error || '未知错误'}`;
        }
      })
      .catch(error => {
        console.error('检查状态失败:', error);
        statusMessage.textContent = `检查状态失败: ${error.message}`;
      });
  }
  
  /**
   * 重置UI到初始状态
   */
  function resetUI() {
    uploadArea.style.display = 'block';
    conversionStatus.style.display = 'none';
    progressBar.style.width = '0%';
    statusMessage.textContent = '';
    downloadButton.style.display = 'none';
    currentTask = null;
    fileInput.value = '';
  }
}); 