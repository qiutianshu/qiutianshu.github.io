---
layout: post
title:  "milkv duo 256M开发板JTAG调试方法"
date:   2025-05-07 13:27:38 +0800
category: riscv
---

本文将深入探讨如何为 milkv duo 256M 开发板开启JTAG调试之门。我将从硬件连接、软件环境配置入手，详细讲解如何利用JTAG接口实现系统级调。

## 调试架构

淘宝cklink-lite调试器，milkv duo256m开发板，杜邦线若干，usb串口调试线：

![milkv duo256m jtag调试原理.jpg](/assets/posts/2025-05-07-milkv-duo-256M开发板JTAG调试方法/milkv_duo256m_jtag%E8%B0%83%E8%AF%95%E5%8E%9F%E7%90%86.jpg)

1. 上位机运行玄铁官方的XuanTie-DebugServer用于和cklink-lite通信，同时开放调试端口给gdb；
2. 上位机运行gdb-multiarch连接到DebugServer，发送调试命令，接收调试数据；
3. cklink-lite起到代理的作用，接收来自上位机的调试命令，把调试命令转化为JTAG协议发送到开发板，解析开发板回传的调试数据，发送回上位机DebugServer；
4. 上位机DebugServer把接收到的调试数据返回给gdb，完成一条调试命令。

## 开发板接线

cklink-lite调试的的TCK、TMS、TDO、TDI、GND分别连接到开发板对应的引脚。注意GND线要接，否则上位机无法通过cklink-lite连接上开发板。

![截屏2025-02-15 10.45.14.png](/assets/posts/2025-05-07-milkv-duo-256M开发板JTAG调试方法/%E6%88%AA%E5%B1%8F2025-02-15_10.45.14.png)

## 上位机准备

从玄铁官网下载DebugServer，执行安装命令：

```bash
$ chmod +x XuanTie_DebugServer-linux-x86_64-V5.18.3-20241119.sh
$ sudo ./XuanTie_DebugServer-linux-x86_64-V5.18.3-20241119.sh -i
```

[XuanTie-DebugServer-linux-x86_64-V5.18.3-20241119.sh](/assets/posts/2025-05-07-milkv-duo-256M开发板JTAG调试方法/XuanTie-DebugServer-linux-x86_64-V5.18.3-20241119.sh)

需要注意的是，DebugServer安装过程中会把/usr/bin/XUANTIE_DebugServer目录添加到动态链接库搜索路径中，这会干扰其他引用的正常运行，解决方法是：

```bash
 删除动态链接库缓存文件
$ sudo rm /etc/ld.so.conf.d/csky-debug.conf
$ sudo ldconfig

```

DebugServerConsole是/usr/bin目录下的脚本文件，在第一行添加cd命令，使得每次运行之前先进入到安装目录，所有DebugServerConsole依赖的库文件都在安装目录下。

![截屏2025-02-17 12.54.16.png](/assets/posts/2025-05-07-milkv-duo-256M开发板JTAG调试方法/%E6%88%AA%E5%B1%8F2025-02-17_12.54.16.png)

## 使能jtag调试功能

查看SG2002芯片手册可知，内存地址0x03001064、0x03001068、0x03001070、0x03001074对应的寄存器分别控制TMS、TCK、TDI、TDO功能的开启。

这四个地址保存的值默认为0，也就是系统一上电默认开启JTAG调试功能。

此时可以调试从FSBL—>uboot—>opensbi这个阶段的程序。

![截屏2025-02-15 13.55.40.png](/assets/posts/2025-05-07-milkv-duo-256M开发板JTAG调试方法/%E6%88%AA%E5%B1%8F2025-02-15_13.55.40.png)

Linux内核启动之后，这四个地址分别都被写入了非零值，应该是内核初始化过程中对JTAG引脚的功能进行了重新设置：

![截屏2025-02-15 14.03.05.png](/assets/posts/2025-05-07-milkv-duo-256M开发板JTAG调试方法/%E6%88%AA%E5%B1%8F2025-02-15_14.03.05.png)

我们把它重新写成0:

![截屏2025-02-15 14.10.10.png](/assets/posts/2025-05-07-milkv-duo-256M开发板JTAG调试方法/%E6%88%AA%E5%B1%8F2025-02-15_14.10.10.png)

再用gdb-multiarch去连：

![截屏2025-02-15 14.12.31.png](/assets/posts/2025-05-07-milkv-duo-256M开发板JTAG调试方法/%E6%88%AA%E5%B1%8F2025-02-15_14.12.31.png)

## 参考资料

JTAG入门之使用JTAG调试路由器：

[物联网安全从零开始-路由器jtag调试分析 - IOTsec-Zone](https://www.iotsec-zone.com/article/375)

[RT-Thread-MilkV Duo 使用 CK-Link DebugRT-Thread问答社区 - RT-Thread](https://club.rt-thread.org/ask/article/5c9e1b656dd77b9c.html)

[【jtag】Jtag debug guide for Duo](https://community.milkv.io/t/jtag-jtag-debug-guide-for-duo/1138)

修改fip.bin文件添加JTAG调试功能：

[Add jtag function for duo-64. · pigmoral/duo-buildroot-sdk@c198e57](https://github.com/pigmoral/duo-buildroot-sdk/commit/c198e570fd25c94260e1024df991c9914c6d4680)