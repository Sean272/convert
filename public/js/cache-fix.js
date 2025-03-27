/**
 * 缓存修复工具
 * 用于解决浏览器缓存导致页面不显示的问题
 */

(function() {
  console.log('缓存修复脚本已加载');

  // 检查页面是否正确加载
  function checkPageLoaded() {
    // 检查关键元素是否存在
    const tabs = document.querySelectorAll('.tab');
    const dropArea = document.getElementById('dropArea') || document.getElementById('pdfDropZone');
    
    if (!tabs.length || !dropArea) {
      console.error('页面关键元素未加载，准备重新加载页面');
      handleReload();
      return false;
    }
    
    return true;
  }

  // 处理页面重载
  function handleReload() {
    // 尝试清除缓存
    if ('caches' in window) {
      caches.keys().then(function(cacheNames) {
        cacheNames.forEach(function(cacheName) {
          caches.delete(cacheName);
        });
      });
    }
    
    // 添加时间戳参数以避免缓存
    const timestamp = new Date().getTime();
    window.location.href = '/reload.html?t=' + timestamp;
  }

  // 页面加载后检查
  window.addEventListener('load', function() {
    setTimeout(function() {
      if (!checkPageLoaded()) {
        console.error('页面加载检查失败');
      } else {
        console.log('页面已正确加载');
      }
    }, 500);
  });

  // 如果5秒后仍然有问题，提供重载按钮
  setTimeout(function() {
    if (document.readyState === 'complete') {
      const container = document.querySelector('.container');
      if (container && !document.querySelector('#reloadButton')) {
        const reloadButton = document.createElement('button');
        reloadButton.id = 'reloadButton';
        reloadButton.textContent = '页面显示异常？点击刷新';
        reloadButton.style.position = 'fixed';
        reloadButton.style.bottom = '10px';
        reloadButton.style.right = '10px';
        reloadButton.style.padding = '10px 15px';
        reloadButton.style.backgroundColor = '#4b6cb7';
        reloadButton.style.color = 'white';
        reloadButton.style.border = 'none';
        reloadButton.style.borderRadius = '4px';
        reloadButton.style.cursor = 'pointer';
        reloadButton.style.zIndex = '9999';
        
        reloadButton.addEventListener('click', handleReload);
        document.body.appendChild(reloadButton);
      }
    }
  }, 5000);
})(); 