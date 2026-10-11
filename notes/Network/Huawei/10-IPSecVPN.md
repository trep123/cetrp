---
title: 分解实验10：IPSec VPN
date: 2026-10-11 11:49
tags: [软考, 网络工程师, 华为, IPSec, VPN, NAT]
description: 在成都、北京两站点出口路由器上先配 NAT 上网，再分别用手动方式和 IKE 自动协商方式建立 IPSec VPN，并解决 NAT 与 VPN 流量 ACL 重叠导致的不通问题。
---

# 分解实验10：IPSec VPN

本实验让成都、北京两个站点先通过 NAT 访问互联网，再分别用手动（manual）和 IKE 自动协商（isakmp）两种方式建立 IPSec VPN，让两站点内网互通且数据加密，同时排查 NAT 抢走 VPN 流量导致不通的典型问题。

<!-- more -->

## 1、实验拓扑及描述

站点 1 和站点 2 为某公司成都和北京两个站点，IP 地址如下表所示。

| 设备编号 | 接口 | IP 地址 | 角色 |
| --- | --- | --- | --- |
| R1 | G0/0/0 | 192.168.10.254/24 | 成都公司出口路由器，内网网关 |
| R1 | G0/0/1 | 100.1.1.1/30 | 成都公司出口路由器，连 ISP |
| ISP | G0/0/0 | 100.1.1.2/30 | 运营商路由器，连 R1 |
| ISP | G0/0/1 | 200.1.1.2/30 | 运营商路由器，连 R2 |
| ISP | LoopBack0 | 2.2.2.2/32 | 模拟互联网地址 |
| R2 | G0/0/0 | 192.168.20.254/24 | 北京公司出口路由器，内网网关 |
| R2 | G0/0/1 | 200.1.1.1/30 | 北京公司出口路由器，连 ISP |
| PC1 | - | 192.168.10.1/24，网关 192.168.10.254 | 成都公司主机 |
| PC2 | - | 192.168.20.1/24，网关 192.168.20.254 | 北京公司主机 |

```text
           成都公司                         ISP                          北京公司
                                  (LoopBack0 2.2.2.2/32)
PC1 ---- GE0/0/0 [R1] GE0/0/1 ---- GE0/0/0 [ISP] GE0/0/1 ---- GE0/0/1 [R2] GE0/0/0 ---- PC2
192.168.10.1/24                 100.1.1.2/30     200.1.1.2/30                  192.168.20.1/24
      192.168.10.254/24  100.1.1.1/30                          200.1.1.1/30  192.168.20.254/24
```

## 2、实验需求

1. 成都和北京两个站点用户均可以访问互联网 2.2.2.2
2. 配置手动 IPSEC VPN，实现成都和北京两个站点内网数据互通，且数据加密
3. 配置自动 IPSEC VPN，实现成都和北京两个站点内网数据互通，且数据加密

## 3、实验步骤及配置

整体步骤：

1. 配置 IP 地址，ISP 路由器用 lo0 模拟互联网
2. 成都和北京两个出口路由器配置默认路由指向 ISP 路由器
3. 进行 IPSEC VPN 配置，让两个站点内网互通，同时数据加密。静态 IPSEC 配置步骤如下，一共分为四步：

| 步骤 | 命令 | 包含的子命令 |
| --- | --- | --- |
| ① 定义需要保护的数据流 | `acl A` | `rule permit ip` |
| ② 配置 IPSEC 安全提议 | `ipsec proposal B` | `transform`、`esp encryption-algorithm`、`esp authentication-algorithm`、`ah authentication-algorithm`、`encapsulation-mode`（可选） |
| ③ 配置手动 IPSEC 安全策略 | `ipsec policy C 10 manual` | `security acl A`、`proposal B`、`tunnel local`、`tunnel remote`、`sa spi inbound`、`sa spi outbound`、`sa string-key inbound`、`sa string-key outbound` |
| ④ 接口上应用安全策略 | `interface xx` | `ipsec policy C` |

```text
① acl A ──────────────┐
   rule permit ip      │      ③ ipsec policy C 10 manual            ④ interface xx
                       └────►    security acl A          ───────►     ipsec policy C
② ipsec proposal B ─────────►    proposal B
   transform                     tunnel local / tunnel remote
   esp encryption-algorithm      sa spi inbound / outbound
   esp authentication-algorithm  sa string-key inbound / outbound
   ah authentication-algorithm
   encapsulation-mode（可选）
```

> **提示**：原图中第④步标题写作「接口在应用安全策略」，此处按语义写作「接口上应用安全策略」。

### Step1：配置 IP 地址，ISP 路由器用 lo0 模拟互联网

R1 配置如下：

```text
<Huawei> system-view
[Huawei] sysname R1
[R1] interface GigabitEthernet0/0/0
[R1-GigabitEthernet0/0/0] ip address 192.168.10.254 24
[R1-GigabitEthernet0/0/0] quit
[R1] interface GigabitEthernet0/0/1
[R1-GigabitEthernet0/0/1] ip address 100.1.1.1 30
```

ISP 配置如下：

```text
<Huawei> system-view
[Huawei] sysname ISP
[ISP] interface GigabitEthernet0/0/0
[ISP-GigabitEthernet0/0/0] ip address 100.1.1.2 30
[ISP-GigabitEthernet0/0/0] quit
[ISP] interface g0/0/1
[ISP-GigabitEthernet0/0/1] ip address 200.1.1.2 30
[ISP-GigabitEthernet0/0/1] quit
[ISP] interface LoopBack0
[ISP-LoopBack0] ip address 2.2.2.2 32
```

R2 配置：

```text
<Huawei> system-view
[Huawei] sysname R2
[R2] interface GigabitEthernet0/0/0
[R2-GigabitEthernet0/0/0] ip address 192.168.20.254 24
[R2-GigabitEthernet0/0/0] quit
[R2] interface GigabitEthernet0/0/1
[R2-GigabitEthernet0/0/1] ip add 200.1.1.1 30
```

PC1 和 PC2 配置（eNSP 中 PC 的「基础配置」页，IPv4 选静态）：

| 主机 | IP 地址 | 子网掩码 | 网关 |
| --- | --- | --- | --- |
| PC1 | 192.168.10.1 | 255.255.255.0 | 192.168.10.254 |
| PC2 | 192.168.20.1 | 255.255.255.0 | 192.168.20.254 |

### Step2：成都和北京两个出口路由器分别配置 NAT 和默认路由，指向 ISP 路由器

路由 R1 配置：

```text
[R1] acl 2000 //配置ACL2000
[R1-acl-basic-2000] rule 10 permit source 192.168.10.0 0.0.0.255 //规则10，匹配源地址为192.168.10.0/24的流量
[R1-acl-basic-2000] quit
[R1] int GigabitEthernet0/0/1
[R1-GigabitEthernet0/0/1] nat outbound 2000 //接口下启用NAT，把ACL2000匹配的私网地址转换为R1 GE0/0/1接口公网IP
[R1-GigabitEthernet0/0/1] quit
[R1] ip route-static 0.0.0.0 0 100.1.1.2 //出口路由器默认路由指向ISP
```

路由 R2 配置：

```text
[R2] acl 2000 //配置ACL2000
[R2-acl-basic-2000] rule 10 permit source 192.168.20.0 0.0.0.255 //规则10，匹配源地址为192.168.20.0/24的流量
[R2-acl-basic-2000] quit
[R2] interface GigabitEthernet0/0/1
[R2-GigabitEthernet0/0/1] nat outbound 2000 //接口下启用NAT，把ACL2000匹配的私网地址转换为R2 GE0/0/1接口公网IP
[R2-GigabitEthernet0/0/1] quit
[R2] ip route-static 0.0.0.0 0 200.1.1.2 //出口路由器默认路由指向ISP
```

PC1 测试访问互联网地址 2.2.2.2，正常通信。

```text
PC1> ping 2.2.2.2
Ping 2.2.2.2: 32 data bytes, Press Ctrl C to break
From 2.2.2.2: bytes=32 seq=1 ttl=254 time=31 ms
From 2.2.2.2: bytes=32 seq=2 ttl=254 time=31 ms
From 2.2.2.2: bytes=32 seq=3 ttl=254 time=16 ms
From 2.2.2.2: bytes=32 seq=4 ttl=254 time=15 ms
From 2.2.2.2: bytes=32 seq=5 ttl=254 time=32 ms
```

PC2 测试访问互联网地址 2.2.2.2，正常通信。

```text
PC2> ping 2.2.2.2
Ping 2.2.2.2: 32 data bytes, Press Ctrl C to break
Request timeout !
From 2.2.2.2: bytes=32 seq=2 ttl=254 time=16 ms
From 2.2.2.2: bytes=32 seq=3 ttl=254 time=31 ms
From 2.2.2.2: bytes=32 seq=4 ttl=254 time=16 ms
From 2.2.2.2: bytes=32 seq=5 ttl=254 time=16 ms
```

PC1 ping PC2，不能通信。

```text
PC1> ping 192.168.20.1
Ping 192.168.20.1: 32 data bytes, Press Ctrl C to break
Request timeout !
Request timeout !
Request timeout !
Request timeout !
Request timeout !
```

> **提示**：注意：原文的 ping 输出中有「seg=」「Reguest」「brea k」「time=1 6 ms」、缺冒号等录入错字，本文各处 ping 输出已统一更正为 eNSP 的实际格式（seq=、Request、break 等），数值未改动。

### Step3：进行 IPSEC VPN 配置（手动方式），让两个站点内网互通，同时数据加密

**第一步：匹配感兴趣的流量**

```text
[R1] acl 3000 //配置ACL3000
[R1-acl-adv-3000] rule 10 permit ip source 192.168.10.0 0.0.0.255 destination 192.168.20.0 0.0.0.255 //规则10，匹配源为192.168.10.0/24，目的为192.168.20.0/24的流量
```

**第二步：配置 ipsec 提议**

```text
[R1] ipsec proposal cd //ipsec提议名称cd
[R1-ipsec-proposal-cd] esp authentication-algorithm sha2-256 //认证算法采用sha2-256
[R1-ipsec-proposal-cd] esp encryption-algorithm aes-128 //加密算法采用aes-128
```

**第三步：配置 ipsec 手动方式安全策略**

```text
[R1] ipsec policy chengdu 10 manual //配置IPSEC策略chengdu，方式为手动
[R1-ipsec-policy-manual-chengdu-10] security acl 3000 //包含acl3000的流量
[R1-ipsec-policy-manual-chengdu-10] proposal cd //采用ipsec提议cd
[R1-ipsec-policy-manual-chengdu-10] tunnel local 100.1.1.1 //配置隧道本地地址100.1.1.1
[R1-ipsec-policy-manual-chengdu-10] tunnel remote 200.1.1.1 //配置隧道远端地址200.1.1.1
[R1-ipsec-policy-manual-chengdu-10] sa spi inbound esp 54321 //配置入方向SA编号54321
[R1-ipsec-policy-manual-chengdu-10] sa string-key inbound esp cipher summer //配置入方向SA的认证密钥为summer
[R1-ipsec-policy-manual-chengdu-10] sa spi outbound esp 12345 //配置出方向SA编号12345
[R1-ipsec-policy-manual-chengdu-10] sa string-key outbound esp cipher summer //配置出方向SA的认证密钥为summer
```

> **提示**：注意：原文第一行注释写作「配置 IPSEC 策略 chegndu」，与命令中的策略名 chengdu 不一致，属拼写错误，已更正为 chengdu。

**第四步：在接口上应用 ipsec 策略**

```text
[R1] interface GigabitEthernet0/0/1
[R1-GigabitEthernet0/0/1] ipsec policy chengdu //接口上应用ipsec策略（只能用于出接口）
```

> **提示**：注意：原文此行注释写作「ipsce 策略」，已更正为 ipsec。另外，原文只列出了 R1 的 IPSec 配置，R2 需按对称方式配置（原文未列出具体命令）。

配置完成后，在 R1 上查看 IPSec SA，已经有静态 SA，算法匹配，没有问题。

```text
[R1] display ipsec sa brief

Number of SAs:2
    Src address     Dst address        SPI    VPN  Protocol     Algorithm
-------------------------------------------------------------------------------
      200.1.1.1       100.1.1.1      54321      0     ESP   E:AES-128 A:SHA2_256_128
      100.1.1.1       200.1.1.1      12345      0     ESP   E:AES-128 A:SHA2_256_128
```

在 R2 上查看 IPSec SA，已经有静态 SA，算法匹配，没有问题。

```text
[R2] display ipsec sa brief

Number of SAs:2
    Src address     Dst address        SPI    VPN  Protocol     Algorithm
-------------------------------------------------------------------------------
      200.1.1.1       100.1.1.1      54321      0     ESP   E:AES-128 A:SHA2_256_128
      100.1.1.1       200.1.1.1      12345      0     ESP   E:AES-128 A:SHA2_256_128
```

在 PC1 上 ping PC2，显示如下，依旧不能正常通信。

```text
PC1> ping 192.168.20.1
Ping 192.168.20.1: 32 data bytes, Press Ctrl C to break
Request timeout !
Request timeout !
Request timeout !
Request timeout !
Request timeout !
```

### 问题分析与解决：NAT 与 IPSec 的 ACL 重叠

问题分析：R1 上配置了 ACL2000 和 ACL3000，其中 ACL2000 用于匹配内部需要 NAT 的地址，ACL3000 用于匹配需要通过 VPN 隧道加密的流量，两条 ACL 重合，即 ACL2000 会把需要进行 VPN 传递的流量匹配出来，进行 NAT。

```text
acl number 2000
 rule 10 permit source 192.168.10.0 0.0.0.255 //匹配内部需要NAT的地址
acl number 3000
 rule 10 permit ip source 192.168.10.0 0.0.0.255 destination 192.168.20.0 0.0.0.255 //匹配需要通过VPN隧道加密的流量
```

R1 进行如下调整，在 NAT 地址池中排除需要进行 VPN 传送的流量。

```text
[R1] interface GigabitEthernet0/0/1
[R1-GigabitEthernet0/0/1] undo nat outbound 2000 //删除NAT在接口上的应用
[R1-GigabitEthernet0/0/1] quit
[R1] undo acl 2000 //删除ACL2000
[R1] acl 3001 //配置ACL3001
[R1-acl-adv-3001] rule 10 deny ip source 192.168.10.0 0.0.0.255 destination 192.168.20.0 0.0.0.255 //设置规则10，拒绝源为192.168.10.0/24，目的是192.168.20.0/24的流量
[R1-acl-adv-3001] rule 20 permit ip //设置规则20，其他流量全部允许
[R1-acl-adv-3001] quit
[R1] interface GigabitEthernet0/0/1
[R1-GigabitEthernet0/0/1] nat outbound 3001 //重新配置NAT转换
```

R2 进行如下调整，在 NAT 地址池中排除需要进行 VPN 传送的流量（同 R1 类似）。

```text
[R2] interface GigabitEthernet0/0/1
[R2-GigabitEthernet0/0/1] undo nat outbound 2000
[R2-GigabitEthernet0/0/1] quit
[R2] undo acl 2000
[R2] acl 3001
[R2-acl-adv-3001] rule 10 deny ip source 192.168.20.0 0.0.0.255 destination 192.168.10.0 0.0.0.255
[R2-acl-adv-3001] rule 20 permit ip
[R2-acl-adv-3001] quit
[R2] interface GigabitEthernet0/0/1
[R2-GigabitEthernet0/0/1] nat outbound 3001
```

在 PC1 ping PC2，可以正常通信。

```text
PC1> ping 192.168.20.1
Ping 192.168.20.1: 32 data bytes, Press Ctrl C to break
Request timeout !
From 192.168.20.1: bytes=32 seq=2 ttl=127 time=16 ms
From 192.168.20.1: bytes=32 seq=3 ttl=127 time=31 ms
From 192.168.20.1: bytes=32 seq=4 ttl=127 time=32 ms
From 192.168.20.1: bytes=32 seq=5 ttl=127 time=15 ms
```

在 R1 接口 g0/0/1 进行抓包，如下所示，流量已经被 ESP 加密，看不到 IP 报头里面的数据内容，实验成功！

```text
No.  Time      Source      Destination  Protocol  Length  Info
 1   0.000000  100.1.1.1   200.1.1.1    ESP       134     ESP (SPI=0x00003039)
 2   0.016000  200.1.1.1   100.1.1.1    ESP       134     ESP (SPI=0x0000d431)
 3   1.032000  100.1.1.1   200.1.1.1    ESP       134     ESP (SPI=0x00003039)
 4   1.047000  200.1.1.1   100.1.1.1    ESP       134     ESP (SPI=0x0000d431)
 5   2.047000  100.1.1.1   200.1.1.1    ESP       134     ESP (SPI=0x00003039)
 6   2.063000  200.1.1.1   100.1.1.1    ESP       134     ESP (SPI=0x0000d431)
 7   3.079000  100.1.1.1   200.1.1.1    ESP       134     ESP (SPI=0x00003039)
 8   3.094000  200.1.1.1   100.1.1.1    ESP       134     ESP (SPI=0x0000d431)
 9   4.110000  100.1.1.1   200.1.1.1    ESP       134     ESP (SPI=0x00003039)
10   4.125000  200.1.1.1   100.1.1.1    ESP       134     ESP (SPI=0x0000d431)

> Frame 1: 134 bytes on wire (1072 bits), 134 bytes captured (1072 bits) on interface 0
> Ethernet II, Src: HuaweiTe_f8:7d:4b (00:e0:fc:f8:7d:4b), Dst: HuaweiTe_8c:67:61 (00:e0:fc:8c:67:61)
> Internet Protocol Version 4, Src: 100.1.1.1, Dst: 200.1.1.1
v Encapsulating Security Payload
    ESP SPI: 0x00003039 (12345)
    ESP Sequence: 100663296
```

> **提示**：SPI 0x00003039 即十进制 12345（R1 出方向），0x0000d431 即十进制 54321（R1 入方向），与手动配置的 SA 编号一一对应。

### Step4：通过 IKE 动态建立 IPSec VPN 隧道（自动方式）

上面是通过手工静态方式建立 IPSEC 隧道，下面我们演示通过 IKE 动态建立 IPSEC VPN 隧道。整体步骤如下，多了①和②两个过程，其他与静态 IPSEC 完全一样。

| 步骤 | 命令 | 包含的子命令 |
| --- | --- | --- |
| ① 配置 IKE 安全提议 | `ike proposal M` | `authentication-method`、`encryption-algorithm`、`dh group14` |
| ② 配置 IKE 对等体 | `ike peer N v1` | `pre-shared-key`、`ike-proposal M`、`local-address 100.1.1.1`、`remote-address 200.1.1.1` |
| ③ 定义需要保护的数据流 | `acl A` | `rule permit ip` |
| ④ 配置 IPSEC 安全提议 | `ipsec proposal B` | `transform`、`esp encryption-algorithm`、`esp authentication-algorithm`、`ah authentication-algorithm`、`encapsulation-mode`（可选） |
| ⑤ 配置自动 IPSEC 安全策略 | `ipsec policy C 10 isakmp` | `security acl A`、`ike-peer N`、`proposal B` |
| ⑥ 接口上应用安全策略 | `interface xx` | `ipsec policy C` |

```text
① ike proposal M ──► ② ike peer N v1 ───────────┐
                        (ike-proposal M)          │
③ acl A ─────────────────────────────────────────┼──► ⑤ ipsec policy C 10 isakmp ──► ⑥ interface xx
④ ipsec proposal B ──────────────────────────────┘       security acl A                 ipsec policy C
                                                          ike-peer N
                                                          proposal B
```

可以重启设备，清空所有配置，按照上述步骤进行重新配置，也可以在原有配置上进行修改。为了简化过程，我们直接在原有配置上修改。

R1 删除原有策略，并配置新策略。

```text
[R1] undo ipsec policy chengdu //删除ipsec策略chengdu
Info:All IPSec configurations with this policy are deleted.
```

**第 1 步：配置 IKE 提议**

```text
[R1] ike proposal 10 //ike提议编号10
[R1-ike-proposal-10] authentication-algorithm sha1 //配置认证算法sha1
[R1-ike-proposal-10] encryption-algorithm aes-cbc-128 //配置加密算法aes-cbc-128（算法为AES，密钥是128位）
[R1-ike-proposal-10] dh group14 //密钥交换协议采用DH，group14表示2048bit DH交换组
```

> **提示**：注意：原文此行注释写作「group14 表示 2014bit DH 交换组」，DH group14 实为 2048 位 MODP 组，已更正为 2048bit。

**第 2 步：配置 ike 对等体**

```text
[R1] ike peer bj v1 //ike对等体为bj，采用ike v1协商对等体
[R1-ike-peer-bj] pre-shared-key cipher summer //配置预共享密钥summer
[R1-ike-peer-bj] ike-proposal 10 //ike提议编号10
[R1-ike-peer-bj] local-address 100.1.1.1 //本地地址100.1.1.1
[R1-ike-peer-bj] remote-address 200.1.1.1 //远端地址200.1.1.1
[R1-ike-peer-bj] quit
```

**第 3 步：配置 ipsec 提议**

```text
[R1] ipsec proposal cd //ipsec提议名称cd
[R1-ipsec-proposal-cd] esp authentication-algorithm sha2-256 //认证算法采用sha2-256
[R1-ipsec-proposal-cd] esp encryption-algorithm aes-128 //加密算法采用aes-128
```

**第 4 步：配置 ipsec 策略**

```text
[R1] ipsec policy chengdu 10 isakmp //配置ipsec策略chengdu，编号10，isakmp表示自动隧道
[R1-ipsec-policy-isakmp-chengdu-10] security acl 3000 //保护ACL3000匹配的流量
[R1-ipsec-policy-isakmp-chengdu-10] ike-peer bj //ike对等体是bj
[R1-ipsec-policy-isakmp-chengdu-10] proposal cd //采用ipsec提议cd
```

**第 5 步：接口下应用安全策略**

```text
[R1] int GigabitEthernet0/0/1
[R1-GigabitEthernet0/0/1] ipsec policy chengdu //应用ipsec策略chengdu
```

> **提示**：同手动方式一样，原文只列出了 R1 的配置，R2 需按对称方式配置（原文未列出具体命令）。

R1 上查看 ipsec sa，自动协商 SPI 号。

```text
[R1] display ipsec sa brief
Number of SAs:2
    Src address     Dst address        SPI    VPN  Protocol     Algorithm
-------------------------------------------------------------------------------
      100.1.1.1       200.1.1.1  483389239      0     ESP   E:AES-128 A:SHA2_256_128
      200.1.1.1       100.1.1.1  408013946      0     ESP   E:AES-128 A:SHA2_256_128
```

PC1 上 ping PC2，通信正常。

```text
PC1> ping 192.168.20.1
Ping 192.168.20.1: 32 data bytes, Press Ctrl C to break
Request timeout!
From 192.168.20.1: bytes=32 seq=2 ttl=127 time=15 ms
From 192.168.20.1: bytes=32 seq=3 ttl=127 time=31 ms
From 192.168.20.1: bytes=32 seq=4 ttl=127 time=16 ms
From 192.168.20.1: bytes=32 seq=5 ttl=127 time=31 ms
```

通信流量已经被 ESP 加密，实验成功！
