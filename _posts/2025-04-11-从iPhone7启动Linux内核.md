---
layout: post
title:  "从 iPhone7 启动 Linux 内核"
date:   2025-04-11 13:27:38 +0800
category: hardware
---

早在2021年4月Linux内核添加了对苹果M1芯片的支持，2024年10月添加了对A7～A11芯片的支持。因此我们打算尝试一下在 iPhone 启动 Linux 内核，并且通过键盘进行交互。 
要在苹果设备启动 Linux 内核，需要针对不同苹果设备的硬件平台配置，对设备树进行微调。

![image.png](/assets/posts/2025-04-11-从iPhone7启动Linux内核/image.png)

基本原理是：

- 借助漏洞利用工具 checkra1n 利用 checkm8 漏洞在 iPhone 端实现任意代码执行；

```bash
$ checkra1n -k Pongo.bin  // Pongo.bin 是上传到 iPhone 的paylod
```

- Pongo.bin 开启 USB 传输服务，提供命令行服务，实现对 iPhone 的任意地址写；
- 通过PongoOS上传Linux压缩内核、设备树、ramdisk文件系统；

```bash
$ ./load_linux.py -k Image.lzma -d dtbpack -r initramfs.cpio.gz
```

- PongoOS设置linux命令行参数，完成物理地址划分，跳转到Linux内核第一行代码；
- 交互的原理是修改 USB gadget 功能为串口，这样在通过数据线连接电脑后会显示 iPhone 为串口设备；
- 在 init 文件中添加 bash 语句，循环读取 /dev/tty 文件的内容作为 bash 命令的输入，这样便实现了上位机通过串口与 iPhone 交互的功能。

漏洞利用效果：

![image.png](/assets/posts/2025-04-11-从iPhone7启动Linux内核/image%201.png)

演示视频：

[iPhone 7 运行 Linux 内核并与上位机交互_哔哩哔哩_bilibili](https://www.bilibili.com/video/BV1DFY5zsEKE?vd_source=cb167874159c7e114d4cd5fd0c4a9ce3)