/**
 * EPUB 转 PDF 工具 - 前端JavaScript
 * 处理文件上传、进度显示和下载功能
 */

// 检查PDF翻译状态
async function checkPdfTranslationStatus(taskId) {
    try {
        const response = await fetch(`/api/status/${taskId}`);
        if (!response.ok) {
            throw new Error(`获取状态失败: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('收到状态更新:', data);
        
        // 更新进度条和状态信息
        const progressContainer = document.getElementById('pdfProgressContainer');
        const progressBar = document.getElementById('pdfProgressBar');
        const progressText = document.getElementById('pdfProgressText');
        const statusMessage = document.getElementById('pdfStatusMessage');
        
        if (progressContainer) progressContainer.style.display = 'block';
        
        // 更新进度
        if (typeof data.progress === 'number') {
            const progress = Math.round(data.progress);
            if (progressBar) progressBar.style.width = `${progress}%`;
            if (progressText) progressText.textContent = `${progress}%`;
        }
        
        // 更新状态消息
        if (statusMessage) {
            statusMessage.textContent = data.message || getStatusMessage(data.status);
        }
        
        // 如果任务还在进行中，继续轮询
        if (data.status === 'processing' || 
            data.status === 'extracting' || 
            data.status === 'translating' || 
            data.status === 'converting') {
            setTimeout(() => checkPdfTranslationStatus(taskId), 2000);
        }
        
        // 如果任务完成，显示下载链接
        if (data.status === 'completed' && data.downloadUrl) {
            const downloadContainer = document.getElementById('pdfDownloadContainer');
            const downloadLink = document.getElementById('pdfDownloadLink');
            if (downloadContainer) downloadContainer.style.display = 'block';
            if (downloadLink) downloadLink.href = data.downloadUrl;
        }
        
    } catch (error) {
        console.error('检查翻译状态时出错:', error);
        const statusMessage = document.getElementById('pdfStatusMessage');
        if (statusMessage) {
            statusMessage.textContent = `检查状态失败: ${error.message}`;
            statusMessage.style.color = '#dc3545';
        }
    }
}

document.addEventListener('DOMContentLoaded', function() {
    console.log('页面已加载，初始化脚本...');
    
    // 获取公共元素
    const tabs = document.querySelectorAll('.tab');
    const tabContents = document.querySelectorAll('.tab-content');
    const errorMessage = document.getElementById('errorMessage');
    const errorText = document.getElementById('errorText');
    
    // 获取EPUB转PDF相关元素
    const fileInput = document.getElementById('fileInput');
    const uploadButton = document.getElementById('uploadBtn');
    const dropArea = document.getElementById('dropArea');
    const uploadArea = document.getElementById('uploadArea');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('statusMessage');
    const progressPercentage = document.getElementById('progressPercentage');
    const downloadArea = document.getElementById('downloadArea');
    const uploadProgress = document.getElementById('progressArea');
    const statusText = document.getElementById('statusMessage');
    const cancelButton = document.getElementById('cancelButton');
    const resetButton = document.getElementById('resetButton');
    const downloadPdfButton = document.getElementById('downloadPdfBtn');
    const downloadTranslationButton = document.getElementById('downloadTranslationBtn');
    const translateOption = document.getElementById('translateOption');
    
    // 获取PDF直接翻译相关元素
    const pdfFileInput = document.getElementById('pdfFileInput');
    const pdfUploadBtn = document.getElementById('pdfUploadBtn');
    const pdfBrowseBtn = document.getElementById('pdfBrowseBtn');
    const pdfDropArea = document.getElementById('pdfDropArea');
    const pdfUploadArea = document.getElementById('pdfUploadArea');
    const pdfProgressBar = document.getElementById('pdfProgressBar');
    const pdfProgressText = document.getElementById('pdfStatusMessage');
    const pdfProgressPercentage = document.getElementById('pdfProgressPercentage');
    const pdfDownloadArea = document.getElementById('pdfDownloadArea');
    const pdfUploadProgress = document.getElementById('pdfProgressArea');
    const pdfStatusText = document.getElementById('pdfStatusMessage');
    const pdfCancelButton = document.getElementById('pdfCancelButton');
    const pdfResetButton = document.getElementById('pdfResetButton');
    const pdfDownloadTranslationButton = document.getElementById('downloadPdfTranslationBtn');
    
    let currentTask = null;
    let currentPdfTask = null;
    
    // 标签页切换功能
    tabs.forEach(tab => {
        tab.addEventListener('click', function() {
            const tabId = this.getAttribute('data-tab');
            
            // 取消当前激活的标签页和内容
            tabs.forEach(t => t.classList.remove('active'));
            tabContents.forEach(content => content.style.display = 'none');
            
            // 激活当前选择的标签页和内容
            this.classList.add('active');
            document.getElementById(tabId).style.display = 'block';
        });
    });
    
    // ===== EPUB转PDF功能 =====
    
    // 浏览按钮点击
    if (document.getElementById('browseBtn')) {
        document.getElementById('browseBtn').addEventListener('click', () => {
            fileInput.click();
        });
    }
    
    // 文件选择事件
    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            if (fileInput.files.length > 0) {
                handleFile(fileInput.files[0]);
            }
        });
    }
    
    // 拖放事件
    if (dropArea) {
        dropArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropArea.classList.add('active');
        });
        
        dropArea.addEventListener('dragleave', () => {
            dropArea.classList.remove('active');
        });
        
        dropArea.addEventListener('drop', (e) => {
            e.preventDefault();
            dropArea.classList.remove('active');
            
            if (e.dataTransfer.files.length > 0) {
                const file = e.dataTransfer.files[0];
                fileInput.files = e.dataTransfer.files;
                handleFile(file);
            }
        });
    }
    
    // 表单提交
    if (document.getElementById('uploadForm')) {
        document.getElementById('uploadForm').addEventListener('submit', function(e) {
            e.preventDefault();
            console.log('表单提交');
            
            if (fileInput.files.length > 0) {
                uploadFile(fileInput.files[0]);
            } else {
                showError('请选择要上传的EPUB文件');
            }
        });
    }
    
    // ===== PDF直接翻译功能 =====
    
    // PDF浏览按钮点击
    if (pdfBrowseBtn) {
        pdfBrowseBtn.addEventListener('click', () => {
            pdfFileInput.click();
        });
    }
    
    // PDF文件选择事件
    if (pdfFileInput) {
        pdfFileInput.addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (file) {
                document.getElementById('selectedFileName').textContent = file.name;
                document.getElementById('selectedFileInfo').style.display = 'block';
            }
        });
    }
    
    // PDF拖放事件
    if (pdfDropArea) {
        pdfDropArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            pdfDropArea.classList.add('dragover');
        });
        
        pdfDropArea.addEventListener('dragleave', () => {
            pdfDropArea.classList.remove('dragover');
        });
        
        pdfDropArea.addEventListener('drop', (e) => {
            e.preventDefault();
            pdfDropArea.classList.remove('dragover');
            const file = e.dataTransfer.files[0];
            if (file && file.type === 'application/pdf') {
                document.getElementById('pdfFileInput').files = e.dataTransfer.files;
                document.getElementById('selectedFileName').textContent = file.name;
                document.getElementById('selectedFileInfo').style.display = 'block';
            }
        });
    }
    
    // PDF上传按钮点击
    if (pdfUploadBtn) {
        pdfUploadBtn.addEventListener('click', () => {
            if (pdfFileInput.files.length > 0) {
                uploadPdfFile(pdfFileInput.files[0]);
            }
        });
    }
    
    // PDF重置按钮点击
    if (pdfResetButton) {
        pdfResetButton.addEventListener('click', () => {
            resetPdfUI();
        });
    }
    
    // PDF取消按钮点击
    if (pdfCancelButton) {
        pdfCancelButton.addEventListener('click', () => {
            if (currentPdfTask) {
                fetch(`/api/cancel/${currentPdfTask}`, { method: 'POST' })
                    .then(() => {
                        resetPdfUI();
                    });
            }
        });
    }
    
    // PDF上传表单提交
    const pdfUploadForm = document.getElementById('pdfUploadForm');
    console.log('PDF表单元素:', pdfUploadForm ? '存在' : '不存在');
    console.log('PDF上传按钮:', pdfUploadBtn ? '存在' : '不存在');
    console.log('PDF文件输入:', pdfFileInput ? '存在' : '不存在');
    
    if (pdfUploadForm) {
        pdfUploadForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            const file = document.getElementById('pdfFileInput').files[0];
            if (!file) {
                alert('请先选择一个PDF文件');
                return;
            }

            const formData = new FormData();
            formData.append('file', file);

            try {
                // 显示进度条
                document.getElementById('pdfProgressContainer').style.display = 'block';
                document.getElementById('pdfChaptersContainer').style.display = 'none';
                document.getElementById('pdfDownloadContainer').style.display = 'none';

                // 发送文件
                const response = await fetch('/api/translate-pdf', {
                    method: 'POST',
                    body: formData
                });

                if (!response.ok) {
                    throw new Error(`上传失败: ${response.status} ${response.statusText}`);
                }

                const data = await response.json();
                if (data.taskId) {
                    // 开始检查转换状态
                    checkPdfTranslationStatus(data.taskId);
                } else {
                    throw new Error(data.error || '上传失败：服务器未返回任务ID');
                }
            } catch (error) {
                console.error('上传出错:', error);
                document.getElementById('pdfStatusMessage').textContent = `上传错误: ${error.message}`;
                document.getElementById('pdfProgressContainer').style.display = 'none';
                setTimeout(() => {
                    resetPdfUI();
                }, 3000);
            }
        });
    }
    
    // 文件大小格式化函数
    function formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    // 处理EPUB文件
    function handleFile(file) {
        if (!file) return;
        
        // 检查是否是EPUB文件
        if (file.name.toLowerCase().endsWith('.epub')) {
            uploadFile(file);
        } else {
            showError('请上传EPUB格式的文件');
        }
    }
    
    // 处理PDF文件
    function handlePdfFile(file) {
        if (!file) return;
        
        // 检查是否是PDF文件
        if (file.name.toLowerCase().endsWith('.pdf')) {
            uploadPdfFile(file);
        } else {
            showError('请上传PDF格式的文件');
        }
    }
    
    // 上传EPUB文件到服务器
    function uploadFile(file) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('translate', translateOption.checked);
        
        // 更新UI状态
        uploadArea.classList.add('hidden');
        uploadProgress.classList.remove('hidden');
        statusText.textContent = `转换中: ${file.name}`;
        progressBar.style.width = '0%';
        progressPercentage.textContent = '0%';
        progressText.textContent = '开始上传...';
        
        // 发送上传请求
        fetch('/api/convert', {
            method: 'POST',
            body: formData
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`上传失败: ${response.status} ${response.statusText}`);
            }
            return response.json();
        })
        .then(data => {
            // 设置当前任务ID
            currentTask = data.taskId;
            
            // 开始轮询转换状态
            checkConversionStatus(data.taskId);
        })
        .catch(error => {
            console.error('上传出错:', error);
            progressText.textContent = `上传错误: ${error.message}`;
            setTimeout(() => {
                resetUI();
            }, 3000);
        });
    }
    
    // 上传PDF文件到服务器
    function uploadPdfFile(file) {
        const formData = new FormData();
        formData.append('file', file);
        
        // 更新UI状态
        document.getElementById('pdfDropArea').style.display = 'none';
        document.getElementById('pdfProgressArea').style.display = 'block';
        document.getElementById('pdfStatusMessage').textContent = `翻译中: ${file.name}`;
        document.getElementById('pdfProgressBar').style.width = '0%';
        document.getElementById('pdfProgressPercentage').textContent = '0%';
        
        // 发送上传请求
        fetch('/api/translate-pdf', {
            method: 'POST',
            body: formData
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`上传失败: ${response.status} ${response.statusText}`);
            }
            return response.json();
        })
        .then(data => {
            // 设置当前任务ID
            currentPdfTask = data.taskId;
            
            // 开始轮询翻译状态
            checkTaskStatus(data.taskId);
        })
        .catch(error => {
            console.error('上传出错:', error);
            document.getElementById('pdfStatusMessage').textContent = `上传错误: ${error.message}`;
            setTimeout(() => {
                resetPdfUI();
            }, 3000);
        });
    }
    
    // 重置EPUB转换UI
    function resetUI() {
        // 清空文件选择
        fileInput.value = '';
        
        // 显示上传区域，隐藏进度和下载区域
        uploadArea.classList.remove('hidden');
        uploadProgress.classList.add('hidden');
        downloadArea.classList.add('hidden');
        
        // 重置进度条
        progressBar.style.width = '0%';
        progressPercentage.textContent = '0%';
        
        // 清除当前任务
        currentTask = null;
    }
    
    // 重置PDF翻译UI
    function resetPdfUI() {
        // 清空文件选择
        pdfFileInput.value = '';
        
        // 显示上传区域，隐藏进度和下载区域
        document.getElementById('pdfDropArea').style.display = 'block';
        document.getElementById('pdfProgressArea').style.display = 'none';
        document.getElementById('pdfDownloadArea').style.display = 'none';
        document.getElementById('selectedFileInfo').style.display = 'none';
        
        // 重置进度条
        document.getElementById('pdfProgressBar').style.width = '0%';
        document.getElementById('pdfProgressPercentage').textContent = '0%';
        
        // 禁用上传按钮
        pdfUploadBtn.disabled = true;
        
        // 清除当前任务
        currentPdfTask = null;
    }
    
    // 更新EPUB转换UI
    function updateUI(data) {
        // 更新上传区域状态
        if (data.status === 'processing') {
            uploadArea.classList.add('hidden');
            uploadProgress.classList.remove('hidden');
            statusText.textContent = `转换中: ${data.filename || '文件'}`;
            
            const progress = data.progress || 0;
            progressBar.style.width = `${progress}%`;
            progressPercentage.textContent = `${progress}%`;
            progressText.textContent = data.message || '处理中...';
            
            // 显示取消按钮
            cancelButton.classList.remove('hidden');
            cancelButton.dataset.taskId = data.id;
            
            // 隐藏下载按钮
            downloadArea.classList.add('hidden');
        } else if (data.status === 'done') {
            uploadArea.classList.add('hidden');
            uploadProgress.classList.add('hidden');
            downloadArea.classList.remove('hidden');
            
            // 显示并设置原文PDF下载按钮
            const pdfDownloadButton = document.getElementById('downloadPdfButton');
            pdfDownloadButton.classList.remove('hidden');
            pdfDownloadButton.onclick = () => {
                window.location.href = data.result.pdfUrl;
            };
            
            // 显示并设置翻译文件下载按钮
            const translationDownloadButton = document.getElementById('downloadTranslationButton');
            translationDownloadButton.classList.remove('hidden');
            translationDownloadButton.onclick = () => {
                window.location.href = data.result.translationUrl;
            };
            
            // 修改提示文本
            document.getElementById('downloadText').textContent = '转换完成！您可以下载以下文件：';
            
            // 隐藏取消按钮
            cancelButton.classList.add('hidden');
        } else if (data.status === 'error') {
            uploadArea.classList.remove('hidden');
            uploadProgress.classList.add('hidden');
            downloadArea.classList.add('hidden');
            
            // 显示错误消息
            showError(`转换失败: ${data.message}`);
            
            // 重置表单
            fileInput.value = '';
            cancelButton.classList.add('hidden');
        }
    }
    
    // 添加这个函数在updatePdfUI中的状态更新部分之前
    function checkForErrorMessages(message) {
        // 检查是否包含特定的错误消息
        if (message.includes('余额不足') || message.includes('API账户余额不足')) {
            // 显示充值提示
            const statusElement = document.getElementById('pdfStatusMessage');
            if (statusElement) {
                statusElement.classList.add('error');
                // 添加充值提示按钮
                const rechargeBtn = document.createElement('button');
                rechargeBtn.textContent = '去充值';
                rechargeBtn.className = 'recharge-btn';
                rechargeBtn.onclick = function() {
                    window.open('https://siliconflow.cn/payment', '_blank');
                };
                
                // 清除之前的按钮(如果有)
                const existingBtn = statusElement.querySelector('.recharge-btn');
                if (existingBtn) {
                    statusElement.removeChild(existingBtn);
                }
                
                statusElement.appendChild(rechargeBtn);
            }
            return true;
        }
        
        // 检查是否有网络错误
        if (message.includes('网络连接错误') || message.includes('ECONNRESET') || 
            message.includes('ETIMEDOUT')) {
            const statusElement = document.getElementById('pdfStatusMessage');
            if (statusElement) {
                statusElement.classList.add('warning');
            }
            return true;
        }
        
        // 检查是否使用了离线模拟翻译
        if (message.includes('离线模拟翻译') || message.includes('翻译质量可能降低')) {
            const statusElement = document.getElementById('pdfStatusMessage');
            if (statusElement) {
                statusElement.classList.add('warning');
            }
            return true;
        }
        
        // 检查是否提示取消任务
        if (message.includes('取消任务')) {
            const statusElement = document.getElementById('pdfStatusMessage');
            if (statusElement) {
                statusElement.classList.add('error');
                
                // 添加取消任务按钮
                const cancelBtn = document.createElement('button');
                cancelBtn.textContent = '取消任务';
                cancelBtn.className = 'cancel-task-btn';
                cancelBtn.onclick = async function() {
                    try {
                        const taskId = document.getElementById('pdfDownloadArea').getAttribute('data-task-id');
                        if (taskId) {
                            const response = await fetch(`/api/cancel/${taskId}`, {
                                method: 'POST'
                            });
                            const result = await response.json();
                            if (result.success) {
                                statusElement.textContent = '任务已取消';
                                statusElement.classList.remove('error');
                                statusElement.classList.add('success');
                            }
                        }
                    } catch (error) {
                        console.error('取消任务失败:', error);
                    }
                };
                
                // 清除之前的按钮(如果有)
                const existingBtn = statusElement.querySelector('.cancel-task-btn');
                if (existingBtn) {
                    statusElement.removeChild(existingBtn);
                }
                
                statusElement.appendChild(cancelBtn);
            }
            return true;
        }
        
        return false;
    }
    
    // 修改updatePdfUI函数，添加错误消息检查
    function updatePdfUI(status) {
        const progressContainer = document.getElementById('pdfProgressContainer');
        const progressBar = document.getElementById('pdfProgressBar');
        const progressText = document.getElementById('pdfProgressText');
        const statusMessage = document.getElementById('pdfStatusMessage');
        const uploadingMessage = document.getElementById('uploadingMessage');
        const chaptersContainer = document.getElementById('pdfChaptersContainer');
        const downloadContainer = document.getElementById('pdfDownloadContainer');

        if (!status) return;

        // 隐藏上传提示
        if (uploadingMessage) {
            uploadingMessage.style.display = 'none';
        }

        // 显示进度条
        progressContainer.style.display = 'block';

        // 更新进度条和状态
        if (typeof status.progress === 'number') {
            const progress = Math.round(status.progress);
            progressBar.style.width = `${progress}%`;
            progressText.textContent = `${progress}%`;
        }

        // 处理状态消息和错误
        if (status.message) {
            // 检查是否包含网络错误相关信息
            const isNetworkError = status.message.includes('网络连接错误') || 
                                 status.message.includes('ECONNRESET') || 
                                 status.message.includes('ETIMEDOUT');
            
            if (isNetworkError) {
                // 网络错误样式
                statusMessage.classList.add('warning');
                statusMessage.classList.remove('error');
                // 添加重试提示
                const retryCount = status.message.match(/第(\d+)次重试/);
                if (retryCount) {
                    statusMessage.textContent = `翻译进行中(${status.progress}%)，网络不稳定，正在第${retryCount[1]}次重试...`;
                } else {
                    statusMessage.textContent = `翻译进行中(${status.progress}%)，网络不稳定，正在重试...`;
                }
            } else {
                const isError = checkForErrorMessages(status.message);
                if (!isError) {
                    statusMessage.classList.remove('error', 'warning');
                }
                statusMessage.textContent = status.message;
            }
        }

        // 处理不同状态
        switch (status.status) {
            case 'processing':
                statusMessage.textContent = `正在处理PDF文件 (${status.progress}%)`;
                break;
            case 'extracting':
                statusMessage.textContent = `正在提取文本内容 (${status.progress}%)`;
                break;
            case 'translating':
                if (!statusMessage.textContent.includes('网络不稳定')) {
                    statusMessage.textContent = `正在翻译文本 (${status.progress}%)`;
                }
                break;
            case 'completed':
                progressContainer.style.display = 'none';
                chaptersContainer.style.display = 'block';
                downloadContainer.style.display = 'block';
                statusMessage.textContent = '翻译完成！';
                if (status.downloadUrl) {
                    document.getElementById('pdfDownloadLink').href = status.downloadUrl;
                }
                break;
            case 'error':
                progressContainer.style.display = 'none';
                chaptersContainer.style.display = 'none';
                downloadContainer.style.display = 'none';
                statusMessage.classList.add('error');
                statusMessage.textContent = status.error || '处理过程中发生错误';
                break;
        }

        // 更新章节列表
        if (status.chapters && status.chapters.length > 0) {
            updateChaptersList(status.chapters, status.taskId);
        }
    }
    
    // 更新章节列表
    function updateChaptersList(chapters, taskId) {
        const chaptersList = document.getElementById('pdfChaptersList');
        chaptersList.innerHTML = '';
        
        chapters.sort((a, b) => {
            const numA = parseInt(a.match(/\d+/)[0]);
            const numB = parseInt(b.match(/\d+/)[0]);
            return numA - numB;
        });

        chapters.forEach(chapter => {
            const li = document.createElement('li');
            const link = document.createElement('a');
            link.href = `/download-chapter/${taskId}/${chapter}`;
            link.textContent = `下载 ${chapter}`;
            li.appendChild(link);
            chaptersList.appendChild(li);
        });
    }
    
    // 检查EPUB转换状态
    function checkConversionStatus(taskId) {
        fetch(`/api/tasks/${taskId}`)
            .then(response => {
                if (!response.ok) {
                    throw new Error('获取任务状态失败');
                }
                return response.json();
            })
            .then(data => {
                // 更新进度条和状态信息
                const progress = data.progress || 0;
                progressBar.style.width = `${progress}%`;
                progressPercentage.textContent = `${progress}%`;
                progressText.textContent = data.message || '处理中...';
                
                // 根据任务状态更新UI
                if (data.status === 'done') {
                    updateUI(data);
                    return; // 转换完成，停止轮询
                } else if (data.status === 'error') {
                    updateUI(data);
                    return; // 出错了，停止轮询
                }
                
                // 继续轮询
                setTimeout(() => checkConversionStatus(taskId), 2000);
            })
            .catch(error => {
                console.error('检查转换状态失败:', error);
                progressText.textContent = `获取状态失败: ${error.message}`;
                
                // 尽管出错，但仍继续尝试轮询
                setTimeout(() => checkConversionStatus(taskId), 5000);
            });
    }
    
    // 获取状态对应的提示信息
    function getStatusMessage(status, progress) {
        switch(status) {
            case 'processing':
                return `正在处理PDF文件 (${progress}%)`;
            case 'extracting':
                return `正在提取文本内容 (${progress}%)`;
            case 'translating':
                return `正在翻译文本 (${progress}%)`;
            case 'converting':
                return `正在生成翻译文件 (${progress}%)`;
            case 'done':
                return '翻译完成！';
            case 'error':
                return '处理出错';
            default:
                return '正在处理...';
        }
    }
    
    // 显示错误消息
    function showError(message) {
        errorMessage.style.display = 'block';
        errorText.textContent = message;
        
        // 3秒后自动隐藏错误消息
        setTimeout(() => {
            errorMessage.style.display = 'none';
        }, 5000);
    }

    // 在页面加载时检查是否需要在DOM中添加章节容器
    const pdfContainer = document.querySelector('.pdf-container');
    
    // 如果容器存在但没有章节列表容器，添加它
    if (pdfContainer && !document.getElementById('pdfChaptersContainer')) {
        // 创建章节容器
        const chaptersContainer = document.createElement('div');
        chaptersContainer.id = 'pdfChaptersContainer';
        chaptersContainer.className = 'action-container';
        chaptersContainer.style.display = 'none';
        
        // 添加标题
        const chaptersTitle = document.createElement('h3');
        chaptersTitle.textContent = '已完成章节';
        chaptersContainer.appendChild(chaptersTitle);
        
        // 添加描述
        const chaptersDesc = document.createElement('p');
        chaptersDesc.textContent = '您可以在翻译过程中下载已完成的章节：';
        chaptersContainer.appendChild(chaptersDesc);
        
        // 添加章节列表
        const chaptersList = document.createElement('ul');
        chaptersList.id = 'pdfChaptersList';
        chaptersContainer.appendChild(chaptersList);
        
        // 将章节容器插入到进度容器之后
        const progressContainer = document.getElementById('pdfProgressContainer');
        if (progressContainer) {
            pdfContainer.insertBefore(chaptersContainer, progressContainer.nextSibling);
        } else {
            pdfContainer.appendChild(chaptersContainer);
        }
    }

    // 加载已恢复的任务
    loadRestoredTasks();
    
    // 刷新任务按钮点击事件
    if (document.getElementById('refreshTasksBtn')) {
        document.getElementById('refreshTasksBtn').addEventListener('click', function() {
            loadRestoredTasks();
        });
    }
});

// 加载已恢复的任务
function loadRestoredTasks() {
    const tasksList = document.getElementById('restoredTasksList');
    
    if (!tasksList) return;
    
    // 显示加载状态
    tasksList.innerHTML = '<p class="loading-text">正在加载已恢复的任务...</p>';
    
    // 加载任务列表
    fetch('/api/restored-tasks')
        .then(response => {
            if (!response.ok) {
                throw new Error('获取任务列表失败');
            }
            return response.json();
        })
        .then(data => {
            if (!data.success) {
                throw new Error(data.error || '获取任务列表失败');
            }
            
            // 渲染任务列表
            renderRestoredTasks(data.tasks);
        })
        .catch(error => {
            console.error('加载任务列表失败:', error);
            tasksList.innerHTML = `<p class="empty-text">加载任务列表失败: ${error.message}</p>`;
        });
}

// 渲染已恢复的任务列表
function renderRestoredTasks(tasks) {
    const tasksList = document.getElementById('restoredTasksList');
    
    if (!tasksList) return;
    
    // 检查是否有任务
    if (!tasks || tasks.length === 0) {
        tasksList.innerHTML = '<p class="empty-text">没有找到已恢复的任务</p>';
        return;
    }
    
    // 创建任务列表HTML
    let html = '';
    
    tasks.forEach(task => {
        const statusClass = getStatusClass(task.status);
        const statusText = getStatusText(task.status);
        
        html += `
            <div class="task-item" data-task-id="${task.id}">
                <div class="task-header">
                    <div class="task-title">${task.title}</div>
                    <div class="task-status ${statusClass}">${statusText}</div>
                </div>
                <div class="task-progress">
                    <div class="task-progress-fill" style="width: ${task.progress || 0}%"></div>
                </div>
                <div class="task-message">${task.message || ''}</div>
                <div class="task-actions">
                    <button class="task-action-btn view-btn" onclick="showTaskDetails('${task.id}')">查看详情</button>
                    ${task.status === 'completed' && task.downloadUrl ? 
                        `<a href="${task.downloadUrl}" class="task-action-btn download-btn" download>下载翻译</a>` : ''}
                </div>
            </div>
        `;
    });
    
    // 更新任务列表
    tasksList.innerHTML = html;
}

// 获取任务状态样式类
function getStatusClass(status) {
    switch (status) {
        case 'completed': return 'status-completed';
        case 'translating':
        case 'processing':
        case 'extracting': return 'status-translating';
        case 'error': return 'status-error';
        default: return '';
    }
}

// 获取任务状态文本
function getStatusText(status) {
    switch (status) {
        case 'completed': return '已完成';
        case 'translating': return '翻译中';
        case 'processing': return '处理中';
        case 'extracting': return '提取中';
        case 'error': return '出错';
        default: return status;
    }
}

// 显示任务详情页面
function showTaskDetails(taskId) {
    // 隐藏任务列表
    document.getElementById('restoredTasksContainer').style.display = 'none';
    
    // 显示任务详情
    const detailsContainer = document.getElementById('taskDetailsContainer');
    detailsContainer.style.display = 'block';
    
    // 设置上传表单的提交事件
    const uploadForm = document.getElementById('resumeUploadForm');
    uploadForm.onsubmit = async (e) => {
        e.preventDefault();
        
        const fileInput = document.getElementById('resumePdfFile');
        const file = fileInput.files[0];
        if (!file) {
            alert('请选择PDF文件');
            return;
        }
        
        const formData = new FormData();
        formData.append('pdf', file);
        
        try {
            // 显示进度区域
            document.getElementById('taskProgress').style.display = 'block';
            document.querySelector('#taskProgress .status-message').textContent = '正在上传文件...';
            
            const response = await fetch(`/api/resume-translation/${taskId}`, {
                method: 'POST',
                body: formData
            });
            
            const data = await response.json();
            if (data.success) {
                // 开始检查翻译状态
                checkPdfTranslationStatus(taskId);
            } else {
                throw new Error(data.message || '上传失败');
            }
        } catch (error) {
            console.error('上传出错:', error);
            document.querySelector('#taskProgress .status-message').textContent = `上传失败: ${error.message}`;
            setTimeout(() => {
                document.getElementById('taskProgress').style.display = 'none';
            }, 3000);
        }
    };
}

// 返回任务列表
function showRestoredTasks() {
    document.getElementById('taskDetailsContainer').style.display = 'none';
    document.getElementById('restoredTasksContainer').style.display = 'block';
    // 刷新任务列表
    loadRestoredTasks();
}

// 查看任务状态
function checkTaskStatus(taskId) {
    // 隐藏上传区域
    document.getElementById('pdfDropZone').style.display = 'none';
    
    // 隐藏已恢复任务列表
    document.getElementById('restoredTasksContainer').style.display = 'none';
    
    // 显示进度区域
    document.getElementById('pdfProgressContainer').style.display = 'block';
    
    // 开始检查状态
    checkPdfTranslationStatus(taskId);
}

// 添加样式到<style>标签
document.head.insertAdjacentHTML('beforeend', `
<style>
  .error {
    color: #e74c3c;
    font-weight: bold;
  }
  .warning {
    color: #e67e22;
    font-weight: bold;
  }
  .success {
    color: #2ecc71;
    font-weight: bold;
  }
  .recharge-btn, .cancel-task-btn {
    margin-left: 10px;
    padding: 5px 10px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
  }
  .recharge-btn {
    background-color: #3498db;
    color: white;
  }
  .cancel-task-btn {
    background-color: #e74c3c;
    color: white;
  }
</style>
`); 