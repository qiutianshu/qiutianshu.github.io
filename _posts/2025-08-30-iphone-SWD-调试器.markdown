---
layout: post
title:  "iPhone SWD 调试器的开发"
date:   2025-08-30 13:27:38 +0800
category: hardware
---

PANDA 2025 安全大会上，我们在 iPhone 7 plus 上面成功启动 Linux 内核，我们继续探索苹果手机硬件安全，并于近日成功打开了  iPhone 7 plus 的 SWD 硬件调试端口。

# lighting 接口原理

[Apple Lightning](https://nyansatan.github.io/lightning/)

[DEF CON 30 - stacksmashing  - The Hitchhacker’s Guide to iPhone Lightning and JTAG Hacking](https://www.youtube.com/watch?v=8p3Oi4DL0eI)

## lighting 接口历史

苹果的 Lightning 接口从 **2012年** 的 iPhone 5 开始启用，直到 **2023年** 的 iPhone 14 系列和 iPhone SE（第3代）为止，之后的机型就全面转向 USB-C 了。

| **手机系列** | **具体型号** | **发布时间** | **状态** |
| --- | --- | --- | --- |
| **iPhone SE** | 第1代、第2代、第3代 | 2016-2022 | 已停产停售 |
| **iPhone 5** | iPhone 5、iPhone 5c、iPhone 5s | 2012-2013 | 已停产停售 |
| **iPhone 6** | iPhone 6、iPhone 6 Plus | 2014 | 已停产停售 |
| **iPhone 7** | iPhone 7、iPhone 7 Plus | 2016 | 已停产停售 |
| **iPhone 8** | iPhone 8、iPhone 8 Plus | 2017 | 已停产停售 |
| **iPhone X** | iPhone X | 2017 | 已停产停售 |
| **iPhone XS** | iPhone XS、iPhone XS Max | 2018 | 已停产停售 |
| **iPhone XR** | iPhone XR | 2018 | 已停产停售 |
| **iPhone 11** | iPhone 11、iPhone 11 Pro、iPhone 11 Pro Max | 2019 | 已停产停售 |
| **iPhone 12** | iPhone 12、iPhone 12 mini、iPhone 12 Pro、iPhone 12 Pro Max | 2020 | 已停产停售 |
| **iPhone 13** | iPhone 13、iPhone 13 mini、iPhone 13 Pro、iPhone 13 Pro Max | 2021 | 已停产停售 |
| **iPhone 14** | iPhone 14、iPhone 14 Plus、iPhone 14 Pro、iPhone 14 Pro Max | 2022 | 已停产停售 |

## lighting 接口实物图

### lighting 母座

母座一般情况下就是我们手机上面的充电口，实际使用8个引脚：

![image.png](/assets/posts/2025-08-30-iphone-SWD-调试器/image.png)

- ID0 和 ID1 是功能选择信号线。当公头插入的时候，公头内置的协议芯片通过这两个引脚与设备通信，告知设备选通“USB通信、串口通信、SWD通信、充电”四者之一的功能。
- L0p L0n 和 L1p L1n 是两对差分线，在USB通信功能被选通的情况下，用于传输 USB 数据。
- PWR 引脚用于充电，或者对外提供电源。

![lightning_port_pinout.jpg](/assets/posts/2025-08-30-iphone-SWD-调试器/lightning_port_pinout.jpg)

### lighting 公头

公头是双面结构，每个面都有8个触点。

![c9153d2417884c2388d32a539ca7310e.webp](/assets/posts/2025-08-30-iphone-SWD-调试器/c9153d2417884c2388d32a539ca7310e.webp)

这个是双面夹层的电气结构，其中 ACC_ID 和 ACC_PWR 分别对应于母座的 ID0 和 ID1 引脚。

可以看到正反两面除了 ACC_ID 、 ACC_PWR两个触点，其他触点都是左右镜像的，这可以保证无论公头的插入方向是什么，供电引脚和数据引脚都能与母座对应。

![公口电气结构.jpg](/assets/posts/2025-08-30-iphone-SWD-调试器/%E5%85%AC%E5%8F%A3%E7%94%B5%E6%B0%94%E7%BB%93%E6%9E%84.jpg)

## lighting 接口电路

lighting 接口电路的核心功能是有一个多路复用器，一端与母座连接，另一端与 SoC 芯片管脚相连。

公头插入母座的时候，公头内部的通信芯片从母座的 PWR 和 GND 引脚获取电源，通过 ID0 和 ID1 与多路复用器通信，通信协议是德州仪器未公开的 SDQ 协议。

通信过程的内容包括功能选通、状态读取、接口配置。

通常情况下用户接触到最多的是 USB 通信和充电这两个功能，

SWD 调试端口功能需要利用 [checkm8](https://www.notion.so/checkm8-1a03f4b7819d80a099bad5da127b8372?pvs=21) 漏洞降级设备之后，再向设备发送特定的 SDQ 序列才能选通，这是本文讨论的主要内容之一。

![未命名绘图.jpg](/assets/posts/2025-08-30-iphone-SWD-调试器/%E6%9C%AA%E5%91%BD%E5%90%8D%E7%BB%98%E5%9B%BE.jpg)

# SDQ 协议原理

SDQ 协议最早是德州仪器公司为苹果设备开发的单线（1-wire）通信协议，该协议至今未开源。

SDQ 通信只需要一根线就能完成，连接主从设备。通常情况下 iPhone 作为主设备，与之相连的数据线作为从设备。

母座检测到公头插入的时候，会在 ID0 和 ID1 两个引脚交替发起轮询，等待应答。

公头通过 ID0 或者 ID1 两者之一的引脚与设备通信。

![image.png](/assets/posts/2025-08-30-iphone-SWD-调试器/image%201.png)

## 例子：USB 数据通信过程

下图是逻辑分析仪抓取到的 USB 通信过程，截取了最开始 SDQ 通信部分。

“74 00 02 1f” 序列由设备的 lighting 接口电路发起，等待外部应答。

插入 lighting 数据线之后，数据线响应 “75 10 09 08 00 00 00 a8” 序列，表示选通 USB 通信功能。

 lighting 接口电路切换电路功能到 USB 数据传输。

![iPhone SWD调试器.jpg](/assets/posts/2025-08-30-iphone-SWD-调试器/iPhone_SWD%E8%B0%83%E8%AF%95%E5%99%A8.jpg)

## 数据格式

![iPhone SWD调试器-数据格式.jpg](/assets/posts/2025-08-30-iphone-SWD-调试器/iPhone_SWD%E8%B0%83%E8%AF%95%E5%99%A8-%E6%95%B0%E6%8D%AE%E6%A0%BC%E5%BC%8F.jpg)

CRC 计算参数如下：

![{D9B360FB-0E77-4008-B9C2-6DA9AF3FB0CF}.png](/assets/posts/2025-08-30-iphone-SWD-调试器/D9B360FB-0E77-4008-B9C2-6DA9AF3FB0CF.png)

## 比特位的表示

单字节中间，比特 0 的周期为 10 微秒，其中低电平占 7 微秒；

![{047CA35B-D51C-4A5B-93DB-6BE63B0F77C1}.png](/assets/posts/2025-08-30-iphone-SWD-调试器/047CA35B-D51C-4A5B-93DB-6BE63B0F77C1.png)

单字节第 7 位，比特 0 的周期为 27.5 微秒，其中低电平占 7 微秒；

![{F14469CC-A9C6-4086-B505-E342B1D73475}.png](/assets/posts/2025-08-30-iphone-SWD-调试器/F14469CC-A9C6-4086-B505-E342B1D73475.png)

单字节中间，比特 1 的周期为 10 微秒，其中低电平占 2 微秒；

![{FC8A4901-1F2C-41CA-AA35-8126F326F0F6}.png](/assets/posts/2025-08-30-iphone-SWD-调试器/FC8A4901-1F2C-41CA-AA35-8126F326F0F6.png)

单字节第 7 位，比特 1 的周期为 27.5 微秒，其中低电平占 2 微秒；

![{5E821473-7509-47DE-B181-4510805D5C55}.png](/assets/posts/2025-08-30-iphone-SWD-调试器/5E821473-7509-47DE-B181-4510805D5C55.png)

## 引脚状态切换

1. iphone 占用信号线，数据线高阻态；
2. 方向切换，耗时大约 120 微秒；
3. 数据线占用信号线，lighting 电路高阻态。

![iPhone SWD调试器-usb通信过程.jpg](/assets/posts/2025-08-30-iphone-SWD-调试器/iPhone_SWD%E8%B0%83%E8%AF%95%E5%99%A8-usb%E9%80%9A%E4%BF%A1%E8%BF%87%E7%A8%8B.jpg)

## lighting 数据线解剖

市售的 lighting 数据线分为 2 类：一类内嵌协议芯片，另一类不带协议芯片。

淘宝平台上若不特殊说明，搜到的都是第一类数据线。

解剖可以看到里面包含了一颗电源芯片和一颗协议芯片。这类数据线插入手机后，会通过母座的 PWR 和 GND 引脚拉取电源，使用 ID0 或者 ID1 引脚与手机的 lighting 接口电路进行 SDQ 通信，根据用户选择的“仅充电”或者“文件传输”选项，选通 USB 功能或者充电功能。

我们只能控制 PWR 、GND 、D+ 、D-  四个引脚。

![lighting解剖.jpg](/assets/posts/2025-08-30-iphone-SWD-调试器/lighting%E8%A7%A3%E5%89%96.jpg)

这类数据线显然不能满足我们的需求，我们需要 8 个引脚都能够被我们控制。淘宝搜索 “lighting 扩展线 ”：

![iPhone SWD调试器-第 5 页.jpg](/assets/posts/2025-08-30-iphone-SWD-调试器/iPhone_SWD%E8%B0%83%E8%AF%95%E5%99%A8-%E7%AC%AC_5_%E9%A1%B5.jpg)

## SDQ 协议破解途径

### 途径一：早期芯片数据手册

德州仪器早年的产品有数据手册流传到网上，有部分功能与现在的产品重合。

![iPhone SWD调试器-第 7 页.jpg](/assets/posts/2025-08-30-iphone-SWD-调试器/iPhone_SWD%E8%B0%83%E8%AF%95%E5%99%A8-%E7%AC%AC_7_%E9%A1%B5.jpg)

### 途径二：富士康工程线抓包

富士康工厂内部的调试线和专用软件经过一些渠道流入二手市场，极客们使用逻辑分析仪嗅探发现了打开 SWD 调试端口的序列码。

![iPhone SWD调试器-第 8 页.jpg](/assets/posts/2025-08-30-iphone-SWD-调试器/iPhone_SWD%E8%B0%83%E8%AF%95%E5%99%A8-%E7%AC%AC_8_%E9%A1%B5.jpg)

![{659BC51B-4FA8-4FA2-AADB-E0753D4C4B11}.png](/assets/posts/2025-08-30-iphone-SWD-调试器/659BC51B-4FA8-4FA2-AADB-E0753D4C4B11.png)

# “山寨”调试器现状

拿到了开启 SWD 调试端口的 “金钥匙”之后，国外有极客团队开发出了专用调试器，比较著名的有：

Bonobo Cable （固件加密、不开源）

Kanzi Cable （不开源）

![image.png](/assets/posts/2025-08-30-iphone-SWD-调试器/image%202.png)

这类调试器普遍比较昂贵，其中 Bonobo Cable 卖到了 749 欧元，折合人民币 6275 元，而且目前是售罄状态。

![{EDE796FA-9EBD-470F-9DCE-567653DA11AD}.png](/assets/posts/2025-08-30-iphone-SWD-调试器/EDE796FA-9EBD-470F-9DCE-567653DA11AD.png)

咸鱼上的 Kanzi Cable 卖到了 1110 元人民币以上，不包好坏，不包售后，懂的来……

![iPhone SWD调试器-第 9 页.jpg](/assets/posts/2025-08-30-iphone-SWD-调试器/iPhone_SWD%E8%B0%83%E8%AF%95%E5%99%A8-%E7%AC%AC_9_%E9%A1%B5.jpg)

# FPGA实现方案

我们无需知晓 SDQ 协议每个字段的意义，只需要按照如下步骤就能打开 SWD 调试端口：

1. 调试的目标设备是受 [checkm8](https://www.notion.so/checkm8-1a03f4b7819d80a099bad5da127b8372?pvs=21) 漏洞影响的 iPhone 设备，这里我们用的是 iPhone 7 plus，处理器型号是 A10 fusion；
2. 使用 [ipwndfu](https://github.com/axi0mX/ipwndfu) 工具对手机进行降级，使能 SWD 调试功能；
3. iphone 发起轮询序列 “74 00 02 1F” ；
4. 外部响应 “75 A0 00 00 00 00 00 40” 序列，这样 lighting 接口就会切换成 SWD 调试口，其中 ID0 引脚对应 SWDIO， ID1 引脚对应 SWCLK；

![iPhone SWD调试器-第 10 页.jpg](/assets/posts/2025-08-30-iphone-SWD-调试器/iPhone_SWD%E8%B0%83%E8%AF%95%E5%99%A8-%E7%AC%AC_10_%E9%A1%B5.jpg)

通过实际抓包测量得到 SDQ 信号的参考电压是 3.3伏

## 物料清单

- 赛灵思 xc7a100t FPGA 开发板；
    
    ![1bf2d0fd6722dcafda05910ac8322b45e4d3b4f2.png@1192w.webp](/assets/posts/2025-08-30-iphone-SWD-调试器/1bf2d0fd6722dcafda05910ac8322b45e4d3b4f2.png1192w.webp)
    
- iPhone 7 plus 手机；
- Jlink 调试器；
    
    ![204d5d3466926f69a3dfde4680533355.jpg](/assets/posts/2025-08-30-iphone-SWD-调试器/204d5d3466926f69a3dfde4680533355.jpg)
    
- 逻辑分析仪；

![微信图片_2025-08-25_204019_775(1).jpg](/assets/posts/2025-08-30-iphone-SWD-调试器/%E5%BE%AE%E4%BF%A1%E5%9B%BE%E7%89%87_2025-08-25_204019_775(1).jpg)

- 自制 lighting 接口转接板

![iPhone SWD调试器-第 11 页.jpg](/assets/posts/2025-08-30-iphone-SWD-调试器/iPhone_SWD%E8%B0%83%E8%AF%95%E5%99%A8-%E7%AC%AC_11_%E9%A1%B5.jpg)

## 器件连接

![iPhone SWD调试器-第 12 页.jpg](/assets/posts/2025-08-30-iphone-SWD-调试器/iPhone_SWD%E8%B0%83%E8%AF%95%E5%99%A8-%E7%AC%AC_12_%E9%A1%B5.jpg)

![e01e492c7dbe195da9e4ad6faeed674d.jpg](/assets/posts/2025-08-30-iphone-SWD-调试器/e01e492c7dbe195da9e4ad6faeed674d.jpg)

上图的各部分作用如下：

- FPGA 检测到 ID0 引脚发出轮询序列，通过 Y16 引脚响应 “75 A0 00 00 00 00 00 40” 序列，选通 lighting 接口电路的 SWD 调试功能；
- FPGA 通过 Y13 引脚提供 20k 电阻下拉，Y16 引脚响应 “75 A0 00 00 00 00 00 40” 序列之后立即切换为 20k 电阻上拉；
- jlink 调试器通过并联的方式接入电路，在 Y16 引脚切换为上拉之后，提供时钟和调试信号。

要注意的是，根据 ADIv6.0 ****规范 page B4-130 的要求，SWDIO 引脚空闲状态下需要上拉以确保引脚处于确定的电平，防止电磁干扰。在实际中，若不上拉，在逻辑分析仪中会观察到很多毛刺，直接导致jlink 调试器无法正确采样。

根据工程实践，SWCLK 引脚在空闲时应该下拉，防止时钟毛刺。

lighting 接口电路并未对 SWDIO 和 SWCLK 引脚进行上下拉，所以在选通 SWD 调试功能后，需要从外部对 SWDIO 和 SWCLK 进行上下拉，否则 jlink 无法正确采集电平。

![iPhone SWD调试器-第 13 页.jpg](/assets/posts/2025-08-30-iphone-SWD-调试器/iPhone_SWD%E8%B0%83%E8%AF%95%E5%99%A8-%E7%AC%AC_13_%E9%A1%B5.jpg)

经过反复实验确定 ID0 20k 下拉、ID1 20k 上拉，这样既能排除信号线毛刺，又能确保 jlink 调试器有足够的驱动能力。

需要注意的是，SWCLK、SWDIO、GND 三根线需要绞在一起，实际测量发现这样做可以消除很大一部分毛刺，提高 jlink 调试器的采样成功率。

## 工作原理

### 开启 SWD 调试端口

信号时序图如下：

![iPhone SWD调试器-第 14 页.jpg](/assets/posts/2025-08-30-iphone-SWD-调试器/iPhone_SWD%E8%B0%83%E8%AF%95%E5%99%A8-%E7%AC%AC_14_%E9%A1%B5.jpg)

FPGA 判断轮询序列的规则是，检测到 2 次 break 信号就判断中间发生了一次轮询：

![iPhone SWD调试器-第 15 页.jpg](/assets/posts/2025-08-30-iphone-SWD-调试器/iPhone_SWD%E8%B0%83%E8%AF%95%E5%99%A8-%E7%AC%AC_15_%E9%A1%B5.jpg)

break 的检测规则是，信号下降沿触发后，低电平持续 13.9 us 即判定产生了一次 break 信号。

实际采样发现，break 信号低电平持续时间在 13.5 ~ 15 us 之间。

![{F2564C13-71E4-4638-AD13-CBAB66B799C2}.png](/assets/posts/2025-08-30-iphone-SWD-调试器/F2564C13-71E4-4638-AD13-CBAB66B799C2.png)

```verilog
// acc引脚采样 
always @(posedge sys_clk or negedge rst) begin
    if(!rst) begin
        break_d0 <= 1'b0;
        break_d1 <= 1'b0;
    end
    else begin
        break_d0 <= acc_pin;                // 对acc_pin引脚的信号打2拍采样
        break_d1 <= break_d0;               // 采到下降沿开始计数，采到上升沿停止计数
    end
end

// 检测到下降沿，break计数器使能
always @(posedge sys_clk or negedge rst) begin
    if(!rst)
        break_cnt_en <= 1'b0;
    else if(acc_down && delay_cnt == DELAY_CNT_MAX) // acc下降沿使能计数器
        break_cnt_en <= 1'b1;
    else if(acc_up)                         // acc上升沿关闭计数器
        break_cnt_en <= 1'b0;
    else
        break_cnt_en <= break_cnt_en;       // 状态位保持
end

// break计数器更新
always @(posedge sys_clk or negedge rst) begin
    if(!rst) begin
        break_cnt <= 10'b0;
    end
    else if(break_cnt_en && break_cnt < BREAK_CNT_MAX)  // 如果检测到下降沿，开始计数
        break_cnt <= break_cnt + 1'b1;
    else if(break_cnt_en && break_cnt == BREAK_CNT_MAX) // 如果低电平达到15us，清零计数器
        break_cnt <= 10'b0;
    else
        break_cnt <= 1'b0;
end

// 发送使能置位
always @(posedge sys_clk or negedge rst) begin
    if(!rst)
        break_ok <= 1'b0;
    else if(break == 2'd2)
        break_ok <= 1'b1;
    else
        break_ok <= break_ok;
end

parameter   SYS_CLK_PERIOD = 20;           // 系统时钟周期，20ns
parameter   BREAK_AVERAGE_PERIOD = 13500;  // break标志位平均时间占据13.5us
parameter   BREAK_MAX_PERIOD = 15000; // break标志位最大时间，如果超过15ms那么判定不是break
parameter   BREAK_CNT_AVERAGE = BREAK_AVERAGE_PERIOD / SYS_CLK_PERIOD;
parameter   BREAK_CNT_MAX = BREAK_MAX_PERIOD / SYS_CLK_PERIOD;
// 判断是否检测到break标志位
always @(posedge sys_clk or negedge rst) begin
    if(!rst)
        break <= 2'b0;         // 低电平持续时间在13.5us ~ 15us之间视为break
    else if(acc_up && break_cnt >= BREAK_CNT_AVERAGE && break_cnt < BREAK_CNT_MAX) 
        break <= break + 1'b1; // break信号计数器递增，在第二个break标志位触发发送swd序列的行为
    else
        break <= break;
end

// 第二次break之后，延迟19us使能发送，这段时间acc引脚会保持高电平
always @(posedge sys_clk or negedge rst) begin
    if(!rst)
        pre_send_cnt <= 10'b0;
    else if(break_ok)
        if(pre_send_cnt < AFTER_BREAK_BEFORE_SEND_CNT_MAX)
            pre_send_cnt <= pre_send_cnt + 1'b1;
        else
            pre_send_cnt <= AFTER_BREAK_BEFORE_SEND_CNT_MAX;
    else
        pre_send_cnt <= 10'b0; 
end

```

若检测到两次 break 信号，则 break_ok 标志位置位，那么 acc 引脚切换到 acc_pin_wire ，

acc_pin_wire 是连接到发送 “75 A0 00 00 00 00 00 40” 序列模块的 wire 类型变量，

 “75 A0 00 00 00 00 00 40” 序列发送完毕后，send_done 标志位置位，acc 切换到高阻态并上拉。

```verilog
// acc引脚功能切换，若发送使能置位，acc_pin和acc_wire相连接，发送序列
// 否则处于高阻态，20k上拉
assign acc_pin = (break_ok && !send_done) ? acc_pin_wire : 1'bz;
assign swclk = 1'bz;   // swclk引脚保持高阻态，20k下拉

// 引脚约束文件
//----------------------------设置ACC引脚3.3v电平--------------------------------
set_property -dict {PACKAGE_PIN Y16 IOSTANDARD LVCMOS33} [get_ports acc_pin]
//---------------------------------设置ACC引脚上拉，上拉电阻20K-------------------
set_property PULLUP TRUE [get_ports {acc_pin}]          
set_property PULLUP_RESISTOR 20K [get_ports {acc_pin}]
//-----------------------------设置SWCLK引脚3.3v电平-----------------------------
set_property -dict {PACKAGE_PIN Y13 IOSTANDARD LVCMOS33} [get_ports swclk]
//-----------------------------设置SWCLK引脚下拉，下拉电阻20K-------------------
set_property PULLDOWN TRUE [get_ports {swclk}]          
set_property PULLDOWN_RESISTOR 20K [get_ports {swclk}]
```

发送 “75 A0 00 00 00 00 00 40” 序列的模块，定义了一个 8 比特的发送缓冲区 byte[7:0]，

若检测到两次 break 信号，send_en 标志位会置位，激活序列发送模块，

单字节发送完毕后，tx_done 标志位置位表示可以发送下一个字节，同时 tx_cnt 计数器递增 1，数据都是硬编码的，

序列发送完毕后，send_success 标志位置位，该标志位会传递到父模块的 send_done ，导致 acc 引脚状态的切换。

```verilog
// 发送序列 75 a0 00 00 00 00 00 40
always @(posedge sys_clk or negedge rst) begin
    if(!rst) begin
        byte <= 8'd0;                         // byte[7:0], 8 比特的发送缓冲
        tx_en <= 1'b0;                        // tx_en, 当前字节发送使能标志位
        send_success <= 1'b0;                 // send_success, 序列发送完毕标志位
    end
    else if(!send_success && send_en) begin
        case(tx_cnt)
            3'd0: begin
                byte <= 8'h75;                // 发送缓冲区写入 0x75
                if(tx_done)
                    tx_en <= 1'b0;
                else
                    tx_en <= 1'b1;
            end
            3'd1: begin
                byte <= 8'ha0;                // 发送缓冲区写入 0xa0
                if(tx_done)
                    tx_en <= 1'b0;
                else
                    tx_en <= 1'b1;
            end
            3'd2: begin
                byte <= 8'h00;                // 发送缓冲区写入 0x00
                if(tx_done)
                    tx_en <= 1'b0;
                else
                    tx_en <= 1'b1;
            end
            3'd3: begin
                byte <= 8'h00;                // 发送缓冲区写入 0x00
                if(tx_done)
                    tx_en <= 1'b0;
                else
                    tx_en <= 1'b1;
            end
            3'd4: begin
                byte <= 8'h00;                // 发送缓冲区写入 0x00
                if(tx_done)
                    tx_en <= 1'b0;
                else
                    tx_en <= 1'b1;
            end
            3'd5: begin
                byte <= 8'h00;                // 发送缓冲区写入 0x00
                if(tx_done)
                    tx_en <= 1'b0;
                else
                    tx_en <= 1'b1;
            end
            3'd6: begin
                byte <= 8'h00;                // 发送缓冲区写入 0x00
                if(tx_done)
                    tx_en <= 1'b0;
                else
                    tx_en <= 1'b1;
            end
            3'd7: begin                       // 发送缓冲区写入 crc-8 校验码 0x40
                byte <= 8'h40;
                if(tx_done) begin
                    tx_en <= 1'b0;
                    send_success <= 1'b1; // 序列 75 a0 00 00 00 00 00 40 发送完成，发送成功标志位置1
                end
                else
                    tx_en <= 1'b1;
            end
            default: begin
                byte <= 8'd0;
                tx_en <= 1'b0;
                send_success <= 1'b0;
            end
        endcase
    end
    else
        tx_en <= 1'b0;                  // 发送成功标志位置1后，发送使能拉低
end
```

### jlink + OpenOCD 调试原理

jlink 调试器连接目标设备和上位机，在上位机命令行启动 openocd 之后，openocd 连接到 jlink 调试器，同时在本地 3333 端口开启监听。

```bash
$ sudo ./openocd -f t8010.cfg -s ../tcl/ -d3
```

使用 gdb 连接到 3333 端口，上位机与目标设备建立调试链路。

```bash
$ gdb-multiarch -ex "target remote localhost:3333"
```

![iPhone SWD调试器-第 16 页.jpg](/assets/posts/2025-08-30-iphone-SWD-调试器/iPhone_SWD%E8%B0%83%E8%AF%95%E5%99%A8-%E7%AC%AC_16_%E9%A1%B5.jpg)

OpenOCD 的作用是，接收来自 gdb 的调试语句，翻译成符合《ARM Debug Interface Architecture Specification》规范的请求，通过 USB 发送给 jlink 调试器。

例如一条 gdb 调试语句 “ info reg ” 可以被翻译成多条对硬件调试寄存器访问的低级语义的语句，这在 ADI 中被称为 DPACC 和 APACC。

jlink 调试器使用固件方案实现了 ADI 中定义的 SWD 协议。

jlink 调试器接到 OpenOCD 请求后，转化为 SWCLK 和 SWDIO 引脚上的电平变化发送到目标设备。

间隔 Trn 个时钟周期之后，jlink 调试器采样 SWDIO 引脚的信号，解析为 ACK，根据 ACK 判断请求的执行结果。

若目标设备成功执行了请求，则 jlink 间隔 Trn 个时钟周期后向目标设备发送数据，或者从目标设备读取数据。

jlink 把读取到的数据和 ACK 返回给 OpenOCD，OpenOCD 把数据整合后，通过本地 3333 端口返回给 gdb 显示给用户。

![{EF3A852C-B563-48F7-BBBE-36BD0E8BF22A}.png](/assets/posts/2025-08-30-iphone-SWD-调试器/EF3A852C-B563-48F7-BBBE-36BD0E8BF22A.png)

### 修改 OpenOCD 源代码

如果不对 OpenOCD 修改而直接使用，会出现如下报错：

![iPhone SWD调试器-第 20 页.jpg](/assets/posts/2025-08-30-iphone-SWD-调试器/iPhone_SWD%E8%B0%83%E8%AF%95%E5%99%A8-%E7%AC%AC_20_%E9%A1%B5.jpg)

第一条对 AP 访问指令还没有完成，导致第二条对 DP 访问的指令出现了 WAIT，但是 jlink 调试器还是继续提交第三条 AP 访问，导致从第三条 AP 访问开始出现错误。

![iPhone SWD调试器-第 19 页.jpg](/assets/posts/2025-08-30-iphone-SWD-调试器/iPhone_SWD%E8%B0%83%E8%AF%95%E5%99%A8-%E7%AC%AC_19_%E9%A1%B5.jpg)

ACK 字段是目标设备对请求的执行结果：

- OK：执行成功，对于写操作可以在 Trn 个时钟周期后传输 WDATA 部分，对于读操作可以在 Trn 个时钟周期后读取 WDATA；
- WAIT：前一条请求还在执行中，本轮操作还需等待；
- FAULT：发生错误。

![{65FE6B35-A16D-4363-A117-F40710051C18}.png](/assets/posts/2025-08-30-iphone-SWD-调试器/65FE6B35-A16D-4363-A117-F40710051C18.png)

由于 jlink 固件尚未开源，我们无从知晓 jlink 调试器是如何处理这些 ACK 响应的。

但是根据逻辑分析仪抓包和 OpenOCD 源码、调试日志的分析可知，

 jlink 调试器本身并不知道如何应对 OK 、 WAIT 、 FAULT 这些响应，它只是如实采集并转发 ACK 和 WDATA 给 OpenOCD，由  OpenOCD 来定夺如何处理每一条结果。

当返回 WAIT 的时候，按照正常的逻辑应该等待若干时钟周期之后再重新向目标设备发送一次请求，确保前一次请求已经执行完毕，但是 OpenOCD 处理 WAIT 的逻辑和处理 FAULT 是一样的，都是直接丢弃结果并返回错误代码。

jlink_swd_run_queue 函数向 jlink 调试器提交请求，接收来自 jlink 调试器的 ACK 和 WDATA。

✅当 ACK ==  OK 时， OpenOCD 把 WDATA 传递给 gdb 显示给用户；

❌当返回 ACK == WAIT 或 FAULT 时， 打印调试器信息并把 ACK 值返回给 jlink_swd_queue_cmd 。

![iPhone SWD调试器-第 17 页.jpg](/assets/posts/2025-08-30-iphone-SWD-调试器/iPhone_SWD%E8%B0%83%E8%AF%95%E5%99%A8-%E7%AC%AC_17_%E9%A1%B5.jpg)

gdb 调试语句翻译过来的 DPACC 和 APACC 命令，由 jlink_swd_queue_cmd 函数加入请求队列，若队列已满，则调用 jlink_swd_run_queue 函数提交给 jlink 调试器执行。

若 jlink 返回的结果中 ACK != OK ，则 jlink_swd_queue_cmd 函数返回，不再继续处理后续的 DPACC 和 APACC 命令。

![iPhone SWD调试器-第 18 页.jpg](/assets/posts/2025-08-30-iphone-SWD-调试器/iPhone_SWD%E8%B0%83%E8%AF%95%E5%99%A8-%E7%AC%AC_18_%E9%A1%B5.jpg)

OpenOCD 默认的处理逻辑是，对 ACK == WAIT 的结果视同为 ACK == FAULT ，直接丢弃。这就要求用户正确编写配置文件，尤其是通信频率要合适，电缆的长度不能过长，以防止 jlink 调试器采样过程出现错误。

![iPhone SWD调试器-第 22 页.jpg](/assets/posts/2025-08-30-iphone-SWD-调试器/iPhone_SWD%E8%B0%83%E8%AF%95%E5%99%A8-%E7%AC%AC_22_%E9%A1%B5.jpg)

但是降低通信频率会导致 SWD 协议信号意外的与 SDQ 中的复位序列重合，导致 lighting 电路复位，无法进入 SWD 调试。

我们的做法是加大 APACC 调试指令后的等待时间，确保目标设备有足够的时间执行 APACC 指令。

OpenOCD 默认等待时间是10个时钟周期，经过我们的多次实验发现，等待 128 个时钟周期能够确保上一条 APACC 指令执行完毕。

![屏幕截图 2025-08-28 103216.png](/assets/posts/2025-08-30-iphone-SWD-调试器/%E5%B1%8F%E5%B9%95%E6%88%AA%E5%9B%BE_2025-08-28_103216.png)

观察对比发现，等待 128 个时钟周期能够很好的确保上一条 APACC 指令执行完毕。

![iPhone SWD调试器-第 21 页.jpg](/assets/posts/2025-08-30-iphone-SWD-调试器/iPhone_SWD%E8%B0%83%E8%AF%95%E5%99%A8-%E7%AC%AC_21_%E9%A1%B5.jpg)

### 编译 OpenOCD 源代码

步骤一：安装必要的依赖

```bash
$ sudo apt install make libtool pkg-config autoconf automake texinfo
```

步骤二：编译 openocd

```bash
$ git clone https://github.com/stacksmashing/openocd.git
$ ./bootstrap   # 通过git clone下载需要这个步骤
$ ./configure --enable-jlink=yes  # 使能 jlink 调试器
$ make -j
```

编译完成后，在 src 目录下即可看到 openocd 可执行文件

![{E7A65551-FD7A-48DB-86BF-D874DB3DF175}.png](/assets/posts/2025-08-30-iphone-SWD-调试器/E7A65551-FD7A-48DB-86BF-D874DB3DF175.png)

### OpenOCD 配置文件

该配置文件修改自 Bonobo Cable 的配置文件：

```bash
interface jlink              # 使用 jlink 调试器
transport select swd         # swd 调试协议
adapter_khz 3000             # 通信频率 3000khz

reset_config srst_only

source [find target/swj-dp.tcl]

if { [info exists CHIPNAME] } {
   set _CHIPNAME $CHIPNAME
} else {
   set _CHIPNAME iphone
}

if { [info exists ENDIAN] } {
   set _ENDIAN $ENDIAN
} else {
   set _ENDIAN little
}

if { [info exists CPUTAPID] } {
   set _CPUTAPID $CPUTAPID
} else {
   if { [using_jtag] } {
      set _CPUTAPID 0x4ba02477
   } {
      # SWD IDCODE
      set _CPUTAPID 0x4ba02477
   }
}
swj_newdap $_CHIPNAME cpu -irlen 6 -ircapture 0x1 -irmask 0xf -expected-id $_CPUTAPID
dap create $_CHIPNAME.dap -chain-position $_CHIPNAME.cpu

# MEM-AP
target create $_CHIPNAME.dbg mem_ap -endian $_ENDIAN -dap $_CHIPNAME.dap -ap-num 1
target create $_CHIPNAME.mem mem_ap -endian $_ENDIAN -dap $_CHIPNAME.dap -ap-num 4

# CPU0
cti create $_CHIPNAME.cpu0.cti -dap $_CHIPNAME.dap -ap-num 1 -ctibase 0xc2020000
target create $_CHIPNAME.cpu0 aarch64 -endian $_ENDIAN -dap $_CHIPNAME.dap -ap-num 1 -dbgbase 0xc2010000 -cti $_CHIPNAME.cpu0.cti -coreid 0 -apple-utt 4 0x202040000 64

# CPU1
cti create $_CHIPNAME.cpu1.cti -dap $_CHIPNAME.dap -ap-num 1 -ctibase 0xc2120000
target create $_CHIPNAME.cpu1 aarch64 -endian $_ENDIAN -dap $_CHIPNAME.dap -ap-num 1 -dbgbase 0xc2110000 -cti $_CHIPNAME.cpu1.cti -coreid 1 -apple-utt 4 0x202140000 64

# SMP
target smp $_CHIPNAME.cpu0 $_CHIPNAME.cpu1

# SEP
target create $_CHIPNAME.sep cortex_a -endian $_ENDIAN -dap $_CHIPNAME.dap -ap-num 1 -dbgbase 0xcda20000

init
```

## 使用演示

[iPhone 7 plus 开启 SWD调试端口的 FPGA 实现方案_哔哩哔哩_bilibili](https://www.bilibili.com/video/BV1D2e1z7Eb1?vd_source=cb167874159c7e114d4cd5fd0c4a9ce3)

验证第一段代码：

![iPhone SWD调试器-第 23 页.jpg](/assets/posts/2025-08-30-iphone-SWD-调试器/iPhone_SWD%E8%B0%83%E8%AF%95%E5%99%A8-%E7%AC%AC_23_%E9%A1%B5.jpg)

验证字符串：

![iPhone SWD调试器-第 24 页.jpg](/assets/posts/2025-08-30-iphone-SWD-调试器/iPhone_SWD%E8%B0%83%E8%AF%95%E5%99%A8-%E7%AC%AC_24_%E9%A1%B5.jpg)