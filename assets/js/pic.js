document.addEventListener('DOMContentLoaded', function() {
    // 创建遮罩层和关闭按钮
    const overlay = document.createElement('div');
    overlay.className = 'zoom-overlay';
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'zoom-close';
    closeBtn.innerHTML = '×';
    closeBtn.setAttribute('aria-label', '关闭放大图片');
    
    document.body.appendChild(overlay);
    document.body.appendChild(closeBtn);
    
    let currentlyZoomed = null;

    // 使用事件委托处理图片点击
    document.addEventListener('click', function(e) {
        const img = e.target.closest('.post__content img');
        if (img) {
            e.preventDefault();
            e.stopPropagation();
            
            // 如果已经有放大的图片，先关闭
            if (currentlyZoomed && currentlyZoomed !== img) {
                resetZoom(currentlyZoomed);
            }
            
            // 切换当前图片的放大状态
            if (img.classList.contains('zoomed')) {
                resetZoom(img);
            } else {
                zoomImage(img);
            }
        }
    });
    
    // 关闭按钮点击事件
    closeBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        if (currentlyZoomed) {
            resetZoom(currentlyZoomed);
        }
    });
    
    // 点击遮罩层关闭
    overlay.addEventListener('click', function(e) {
        if (e.target === overlay && currentlyZoomed) {
            resetZoom(currentlyZoomed);
        }
    });
    
    // ESC键关闭
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && currentlyZoomed) {
            resetZoom(currentlyZoomed);
        }
    });
    
    // 放大图片函数
    function zoomImage(img) {
        img.classList.add('zoomed');
        overlay.classList.add('active');
        closeBtn.classList.add('active');
        currentlyZoomed = img;
        
        // 防止页面滚动
        document.body.style.overflow = 'hidden';
        document.documentElement.style.overflow = 'hidden';
        
        // 添加类到父容器
        img.closest('.post__content')?.classList.add('zooming-active');
    }
    
    // 重置放大函数
    function resetZoom(img) {
        img.classList.remove('zoomed');
        overlay.classList.remove('active');
        closeBtn.classList.remove('active');
        currentlyZoomed = null;
        
        // 恢复页面滚动
        document.body.style.overflow = '';
        document.documentElement.style.overflow = '';
        
        // 移除父容器类
        img.closest('.post__content')?.classList.remove('zooming-active');
    }
});