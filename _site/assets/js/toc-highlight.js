document.addEventListener('DOMContentLoaded', function() {
    const tocLinks = document.querySelectorAll('.toc-list a');
    if (tocLinks.length === 0) return;
    
    const headerHeight = document.querySelector('header') ? document.querySelector('header').offsetHeight : 0;
    const offset = headerHeight + 20;
    
    // 创建 Intersection Observer
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const id = entry.target.getAttribute('id');
            const tocLink = document.querySelector(`.toc-list a[href="#${id}"]`);
            
            if (entry.isIntersecting) {
                // 移除所有 active 类
                tocLinks.forEach(link => link.classList.remove('active'));
                // 添加 active 类到当前链接
                if (tocLink) {
                    tocLink.classList.add('active');
                }
            }
        });
    }, {
        rootMargin: `-${offset}px 0px -50% 0px`, // 调整观察区域
        threshold: 0.1 // 当 10% 的标题可见时触发
    });
    
    // 观察所有标题
    document.querySelectorAll('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]').forEach((section) => {
        observer.observe(section);
    });

    // 平滑滚动到对应位置
    tocLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            const targetId = this.getAttribute('href').substring(1);
            const targetElement = document.getElementById(targetId);
            if (targetElement) {
                window.scrollTo({
                    top: targetElement.offsetTop - offset,
                    behavior: 'smooth'
                });
            }
        });
    });
});