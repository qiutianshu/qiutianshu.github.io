---
layout: post
title:  "ramoops越界拷贝bug分析"
date:   2024-08-26 13:27:38 +0800
category: linux_kernel
---
[是谁在LINUX内核中开了这个大洞？](https://mp.weixin.qq.com/s/Sr4qIy-AdLhpkus6q1su9w)


## 一、环境配置

### 1. 内核环境配置

内核版本：Linux-6.1.43

ramoops的内核部分的配置用于指定日志在内存中保存的位置、日志的总空间大小、分配给不同日志的空间、使能向用户态文件系统的更新。

![截屏2024-08-26 09.09.29.png](/assets/posts/2024-08-26-ramoops越界拷贝bug分析/1.png)

通过向grub启动配置文件中“GRUB_CMDLINE_LINUX_DEFAULT”选项添加内核启动参数即可完成配置。

这部分选项内容可以参考文件“fs/pstore/ram.c”和“fs/pstore/platform.c”中对ramoops模块和pstore模块参数定义的部分

### 2. 用户空间环境配置

修改/etc/systemd/pstore.conf的”Unlink=no“，这一行默认是被注释掉的，需要手动打开并且指定为no，这个关系到我们能否触发bug。

![截屏2024-08-26 09.20.34.png](/assets/posts/2024-08-26-ramoops越界拷贝bug分析/2.png)

## 二、pstore/ramoops功能分析

ramoops是众多pstore底层介质之一，用于在计算机reboot的过程中保存上一次开机运行时产生的内核oops日志，所依赖的底层原理是reboot过程中内存不会断电，保存在特定物理内存地址的内容在开机过程中就可以被重新读取。

这个功能为内核开发者提供了在内核崩溃的情况下查看崩溃现场的手段。

该功能由两部分组成：1. 位于内核的pstore/ramoops  2. 位于用户态的systemd和systemd.pstore服务。

发生oops的日志保存流程：

![0day-oops打印流程.jpg](/assets/posts/2024-08-26-ramoops越界拷贝bug分析/3.jpg)

                                                                   

![0day-第 4 页.jpg](/assets/posts/2024-08-26-ramoops越界拷贝bug分析/4.jpg)

日志的提取和导出到sys文件系统的流程：

![截屏2024-08-26 10.02.44.png](/assets/posts/2024-08-26-ramoops越界拷贝bug分析/5.png)

ramoops将回调函数注册到内核打印函数上，一旦发生oops便会调用ramoops功能，将日志写入用户指定的物理地址，同时将日志以文件的形式导出到/sys/fs/pstore目录下。

pstore文件系统的开机挂载过程：

![0day-systemd挂载流程.jpg](/assets/posts/2024-08-26-ramoops越界拷贝bug分析/6.jpg)
                                                     
systemd.pstore服务的配置解析：

![截屏2024-08-26 10.16.17.png](/assets/posts/2024-08-26-ramoops越界拷贝bug分析/7.png)

systemd在系统初始化过程中,把pstore文件系统挂载到/sys/fs/pstore目录下。systemd.pstore服务用于将/sys/fs/pstore目录下的日志文件转移到/var/lib/systemd/pstore目录下并持久化。

## 三、关键的内核结构体

![0day-白板.jpg](/assets/posts/2024-08-26-ramoops越界拷贝bug分析/8.jpg)

## 四、漏洞产生的原因

![0day.jpg](/assets/posts/2024-08-26-ramoops越界拷贝bug分析/9.jpg)

![截屏2024-08-26 10.58.32.png](/assets/posts/2024-08-26-ramoops越界拷贝bug分析/10.png)

### prz→buffer→size的修改路径：

![0day-第 6 页.jpg](/assets/posts/2024-08-26-ramoops越界拷贝bug分析/11.jpg)

在向ramoops内存区域写入日志过程中，首先把prz→buffer→size和prz→buffer→start两个字段清零，再根据日志内容长度，调用buffer_size_add()函数重新设置size和start字段，再向prz→buffer→data区域写入日志数据。

### prz→buffer→size的约束：

prz→buffer→size不超过prz→buffer_size。

![截屏2024-08-26 11.26.58.png](/assets/posts/2024-08-26-ramoops越界拷贝bug分析/12.png)

prz→buffer_size由size减去结构体buffer头部结构的大小，而size由内核启动参数中的ramoops.record_size传递进来，所以prz→buffer_size可以由“攻击者”控制。

进而导致prz→buffer→size的上限可以由“攻击者”控制。

### 漏洞场景：

step1: 写一个内核模块，触发空指针引用，产生一个较小的oops日志，reboot；

step2: reboot之后，内核分配一个较小的old_size对象存储oops日志；

step3: 重新写一个内核模块，在函数嵌套中触发空指针引用，产生一个较大的oops日志；

step4: 在定时器的作用下，内核按照500ms的时间间隔触发漏洞函数，将较大的oops日志写入之前的old_log对象中，触发越界写。

## 五、漏洞调试过程

断点：

```jsx
b ram.c:385.           #breakpoint 32  检查第二次日志的长度是否大于old_log_size
```

![截屏2024-08-23 13.18.47.png](/assets/posts/2024-08-26-ramoops越界拷贝bug分析/13.png)

确认第二次的日志长度大于old_log_size，c继续运行，让定时器回调函数调用漏洞函数

ctrl+c，回过头检查一下是否发生溢出

### systemd选项unlink=no的作用

在前期调试过程中发现，在断点处old_log被释放掉了，导致prz→old_log=0，old_log_size=0。

![截屏2024-08-26 13.00.01.png](/assets/posts/2024-08-26-ramoops越界拷贝bug分析/14.png)

old_log对象由persistent_ram_free_old()函数释放，对该函数下断点，并且栈回溯，发现由用户态调用过来的，最终调用到ramoops_pstore_erase函数，该函数的作用是清除旧的日志，瞬间联想到systemd.pstore配置文件中unlink选项的作用，将日志从/sys目录搬到/var之后清除/sys目录下的内容。因此设置unlink=no就可以避免进入释放old_log的路径。

![截屏2024-08-26 13.03.21.png](/assets/posts/2024-08-26-ramoops越界拷贝bug分析/15.png)

## 六、漏洞可利用性分析

| 需要root权限 | ✅ |
| --- | --- |
| 攻击者控制堆块内容 | ❓🤔 |
| 堆喷射？ | 😭😭 |
| 攻击者精准控制覆盖指针 | 😭😭😭 |

## 七、补丁建议

```c
void persistent_ram_save_old(struct persistent_ram_zone *prz)
{
		struct persistent_ram_buffer *buffer = prz->buffer;
		size_t size = buffer_size(prz);
		size_t start = buffer_start(prz);

		if (!size)
				return;
				
++  if（size > prz->old_log_size && prz->old_log_size != 0 && prz->old_log != NULL）{
++		  persistent_ram_ecc_old(prz);              //更新ecc info
++			kfree(prz->old_log);                      //释放掉旧的old_log
++		  prz->old_log = kmalloc(size, GFP_KERNEL); //分配新的old_log
++	}

		if (!prz->old_log) {
				persistent_ram_ecc_old(prz);
				prz->old_log = kmalloc(size, GFP_KERNEL);
		}
			
		if (!prz->old_log) {
				pr_err("failed to allocate buffer\n");
				return;
		}

		prz->old_log_size = size;                    //更新old_log_size
		memcpy_fromio(prz->old_log, &buffer->data[start], size - start);
		memcpy_fromio(prz->old_log + size - start, &buffer->data[0], start);
}
```