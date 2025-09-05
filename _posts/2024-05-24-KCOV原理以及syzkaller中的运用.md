---
layout: post
title:  "KCOV原理以及syzkaller中的运用"
date:   2024-05-24 13:27:38 +0800
category: linux_kernel
---


这篇文章介绍了remote KCOV的原理和使用

[Syzkaller diving 03](https://f0rm2l1n.github.io/2021-02-10-syzkaller-diving-03/)

remote KCOV的这段注释值得好好读一遍：

```c
/*
 * kcov_remote_start() and kcov_remote_stop() can be used to annotate a section
 * of code in a kernel background thread or in a softirq to allow kcov to be
 * used to collect coverage from that part of code.
 *
 * The handle argument of kcov_remote_start() identifies a code section that is
 * used for coverage collection. A userspace process passes this handle to
 * KCOV_REMOTE_ENABLE ioctl to make the used kcov device start collecting
 * coverage for the code section identified by this handle.
 *
 * The usage of these annotations in the kernel code is different depending on
 * the type of the kernel thread whose code is being annotated.
 *
 * For global kernel threads that are spawned in a limited number of instances
 * (e.g. one USB hub_event() worker thread is spawned per USB HCD) and for
 * softirqs, each instance must be assigned a unique 4-byte instance id. The
 * instance id is then combined with a 1-byte subsystem id to get a handle via
 * kcov_remote_handle(subsystem_id, instance_id).
 *
 * For local kernel threads that are spawned from system calls handler when a
 * user interacts with some kernel interface (e.g. vhost workers), a handle is
 * passed from a userspace process as the common_handle field of the
 * kcov_remote_arg struct (note, that the user must generate a handle by using
 * kcov_remote_handle() with KCOV_SUBSYSTEM_COMMON as the subsystem id and an
 * arbitrary 4-byte non-zero number as the instance id). This common handle
 * then gets saved into the task_struct of the process that issued the
 * KCOV_REMOTE_ENABLE ioctl. When this process issues system calls that spawn
 * kernel threads, the common handle must be retrieved via kcov_common_handle()
 * and passed to the spawned threads via custom annotations. Those kernel
 * threads must in turn be annotated with kcov_remote_start(common_handle) and
 * kcov_remote_stop(). All of the threads that are spawned by the same process
 * obtain the same handle, hence the name "common".
 *
 * See Documentation/dev-tools/kcov.rst for more details.
 *
 * Internally, kcov_remote_start() looks up the kcov device associated with the
 * provided handle, allocates an area for coverage collection, and saves the
 * pointers to kcov and area into the current task_struct to allow coverage to
 * be collected via __sanitizer_cov_trace_pc().
 * In turns kcov_remote_stop() clears those pointers from task_struct to stop
 * collecting coverage and copies all collected coverage into the kcov area.
 */
```

首先ioctl执行完成后，在内核中分配了一个struct kcov的对象，该对象与用户态进程的task_struct相关联。因为在内核线程或者延迟任务中，task_struct不是用户态进程的，因此普通的KCOV不知道该把覆盖率信息保存到哪里。

kcov_remote_start(HANDLE)根据HANDLE找到和用户态task_struct相关联的kcov，将内核线程的task_struct和kcov相关联，分配一个临时的缓冲区area保存覆盖率信息，并且该area是和内核的task_struct相关联的（不是直接和用户态task_struct相关联）。

剩下的事情就和普通的KCOV一样了，不同的是普通的KCOV是将覆盖率信息直接保存在用户态进程task_struct相关联的area中，而remote KCOV则是保存在内核线程相关联的arra中，在退出的时候才转移到和用户态task_struct相关联的area中。

kcov_remote_stop()将area里面的覆盖率信息和kcov中已有的合并。

![未命名绘图.drawio.svg](/assets/posts/2024-05-24-KCOV原理以及syzkaller中的运用/1.svg)

这篇文章介绍了普通KCOV的原理和使用，以及syzkaller如何接受一个新的测试路径的，对signal机制、覆盖率报告机制进行了介绍

[Syzkaller Diving 01](https://f0rm2l1n.github.io/2021-02-02-syzkaller-diving-01/)

这篇文章介绍了Linux内核引入kcov的过程、kcov的实现原理

[kernel: add kcov code coverage  [LWN.net]](https://lwn.net/Articles/671640/)

这篇文章介绍了remote KCOV的原理和使用范围，示例代码见Documentation/dev-tools/kcov.rst

[kcov: improve documentation [LWN.net]](https://lwn.net/Articles/924813/)