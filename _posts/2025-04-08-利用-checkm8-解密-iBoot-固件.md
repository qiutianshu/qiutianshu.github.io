---
layout: post
title:  "利用 checkm8 解密 iBoot 固件"
date:   2025-04-08 13:27:38 +0800
category: hardware
---
硬件 GID 是同一型号或批次的苹果处理器共享一串字符，它是 iPhone **固件加密**的种子。GID 在处理器制造的过程中被固化于 SEP 处理器中，它的存储与处理过程
都在 SEP 处理器中隐秘地进行，无法被外界观测和调试。本文利用 checkm8 漏洞实现任意代码执行，对 SecureROM 中的解密函数进行 hook，在不接触 GID 的情况下对固件
升级包的 iv 和 key 进行解密，最终实现对苹果升级固件的解密。

## 背景知识

固件升级包采用AES加密算法

固件的文件格式为img4格式

iv 和 key 作为 KBAG 类型的对象，附在 img4 文件的末尾

iv 和 key 经过GID加密

GID 烧写在应用处理器的ROM中

GID 无法被直接访问，也无法通过JTAG读取

![4.png](/assets/posts/2025-04-08-利用-checkm8-解密-iBoot-固件/4.png)

## 基本原理

- 使用 ipsw 工具从升级包提取出加密的 iv 和 key；
- 使用 ipwndfu 工具利用 checkm8 漏洞任意代码执行，把加密的 iv 和 key 提交给 SecureROM 解密功能函数进行解密，ipwndfu 返回解密后的 iv 和 key；
- 用解密后的 iv 和 key 对固件进行解密。

## 操作步骤

步骤一：从img4文件中提取被加密的 iv 和 key

![1.png](/assets/posts/2025-04-08-利用-checkm8-解密-iBoot-固件/1.png)

步骤二：ipwndfu解密 iv 和 key

![2.png](/assets/posts/2025-04-08-利用-checkm8-解密-iBoot-固件/2.png)

步骤三：解密 iBoot固件

![3.png](/assets/posts/2025-04-08-利用-checkm8-解密-iBoot-固件/3.png)

## 附件

iBoot 升级包：[iBoot.d11.RELEASE.im4p](/assets/posts/2025-04-08-利用-checkm8-解密-iBoot-固件/iBoot.d11.RELEASE.im4p)