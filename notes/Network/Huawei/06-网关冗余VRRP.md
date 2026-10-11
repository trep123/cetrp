---
title: 分解实验06：网关冗余VRRP
date: 2026-10-11 11:53
tags: [软考, 网络工程师, 华为, VRRP]
description: 在两台核心交换机上配置 VRRP 备份组 10（虚拟 IP 192.168.10.254），通过优先级和抢占延时实现网关主备切换，并用 tracert 验证切换前后的转发路径。
---

# 分解实验06：网关冗余VRRP

本实验在 coresw1 和 coresw2 上配置 VRRP 备份组，对 PC 体现为一台虚拟网关 192.168.10.254：正常时 coresw1 为 Master，调高 coresw2 优先级后由 coresw2 接替，用 tracert 验证路径切换。

<!-- more -->

## 一、VRRP 原理

VRRP（Virtual Router Redundancy Protocol，虚拟路由器冗余协议）用来提供网关冗余功能，从而提升网络可靠性。如下图所示，PC 通过 acsw 双归到 coresw1 和 coresw2。可以在 coresw1 和 coresw2 上配置 VRRP 备份组，对外体现为一台虚拟路由器，实现冗余备份，任何一台网关设备故障都不会影响 PC 访问互联网。

### 网络拓扑

| 设备 | 接口 | IP/掩码 | 所属 VLAN / 角色 |
| --- | --- | --- | --- |
| router（出口路由器） | GE0/0/0 | 100.1.1.2/30 | 连接 Internet |
| router | GE0/0/1 | 192.168.100.2/30 | 连接 coresw1 GE0/0/2 |
| router | GE0/0/2 | 192.168.200.2/30 | 连接 coresw2 GE0/0/2 |
| Internet | GE0/0/0 | 100.1.1.1/30 | 运营商侧 |
| coresw1 | Vlanif10 | 192.168.10.252/24 | 用户网关，VRRP Master（优先级 120） |
| coresw1 | 互联 Vlanif100 | 192.168.100.1/30 | GE0/0/2（Access VLAN 100）连 router |
| coresw1 | GE0/0/1 | — | Trunk，连 acsw GE0/0/1 |
| coresw1 | GE0/0/3 | — | Trunk，连 coresw2 GE0/0/3 |
| coresw2 | Vlanif10 | 192.168.10.253/24 | 用户网关，VRRP Backup（默认优先级 100） |
| coresw2 | 互联 Vlanif200 | 192.168.200.1/30 | GE0/0/2（Access VLAN 200）连 router |
| coresw2 | GE0/0/1 | — | Trunk，连 acsw GE0/0/2 |
| coresw2 | GE0/0/3 | — | Trunk，连 coresw1 GE0/0/3 |
| VRRP 虚拟路由器 | VRID 10 | 192.168.10.254 | 虚拟网关（Virtual IP） |
| acsw（接入交换机） | GE0/0/1、GE0/0/2 | — | Trunk，分别上联 coresw1、coresw2 |
| acsw | GE0/0/3 | — | Access VLAN 10，连 PC |
| PC | — | 192.168.10.1/24 | VLAN 10 用户 |

```text
                       Internet 100.1.1.1/30
                          |
                   GE0/0/0 100.1.1.2/30
                       [router]
     GE0/0/1 192.168.100.2/30   GE0/0/2 192.168.200.2/30
              /                         \
       GE0/0/2                           GE0/0/2
     [coresw1] GE0/0/3 ------------ GE0/0/3 [coresw2]
       GE0/0/1     VRRP虚拟IP 192.168.10.254     GE0/0/1
              \                         /
         GE0/0/1                   GE0/0/2
                        [acsw]
                       GE0/0/3
                          |
                PC VLAN 10 192.168.10.1/24
```

右侧逻辑图：coresw1 与 coresw2 对 PC 而言合成一台虚拟路由器（VRRP VRID 10，Virtual IP：192.168.10.254），PC 经 acsw 接到这台虚拟网关，再由 router 访问 Internet。

### VRRP 的工作过程

1. VRRP 备份组中的设备根据优先级选举出主设备 Master，负责用户数据转发。
2. Master 设备周期性向备份组内所有 Backup 设备发送 VRRP 通告报文，以公布其配置信息（优先级等）和工作状况。
3. 如果 Master 设备出现故障，VRRP 备份组中的 Backup 设备将根据优先级重新选举新的 Master。
4. VRRP 备份组状态切换时，新的 Master 设备会立即发送携带虚拟路由器的虚拟 MAC 地址和虚拟 IP 地址信息的免费 ARP 报文，刷新与它连接的主机或设备中的 MAC 表项，从而把用户流量引到新的 Master 设备上来，整个过程对用户无感知。
5. 原 Master 设备故障恢复时，若该设备为 IP 地址拥有者（优先级为 255，默认优先级 100），将直接切换至 Master 状态。若该设备优先级小于 255，将首先切换至 Backup 状态，且其优先级恢复为故障前配置的优先级。

## 二、实验需求

1. 配置 VRRP 网关冗余，正常情况下，主机以 coresw1 为默认网关接入 Internet，当 coresw1 故障时，coresw2 接替作为网关继续进行工作，实现网关的冗余备份。
2. coresw1 故障恢复后，可以在 20 秒内重新成为网关。

## 三、实验配置过程与命令

### 1、配置 VLAN 和 IP 地址

配置接入交换机 acsw：

```text
<Huawei> system-view //由用户模式进入系统模式
[Huawei] sysname acsw //交换机重命名
[acsw] vlan batch 10 //创建VLAN 10
[acsw] interface GigabitEthernet0/0/1 //进入接口GigabitEthernet0/0/1
[acsw-GigabitEthernet0/0/1] port link-type trunk //把接口配置成trunk模式
[acsw-GigabitEthernet0/0/1] port trunk allow-pass vlan all //trunk运行所有VLAN通过
[acsw-GigabitEthernet0/0/1] interface GigabitEthernet0/0/2
[acsw-GigabitEthernet0/0/2] port link-type trunk
[acsw-GigabitEthernet0/0/2] port trunk allow-pass vlan all
[acsw-GigabitEthernet0/0/2] interface GigabitEthernet0/0/3
[acsw-GigabitEthernet0/0/3] port link-type access //把接口配置成access模式
[acsw-GigabitEthernet0/0/3] port default vlan 10 //把接口划到VLAN 10
[acsw-GigabitEthernet0/0/3] quit //退出
[acsw]
```

配置 coresw1：

```text
<Huawei> system-view
[Huawei] sysname coresw1
[coresw1] vlan batch 10 100 //批量创建VLAN 10和100
[coresw1] interface Vlanif10 //进入接口Vlanif10
[coresw1-Vlanif10] ip address 192.168.10.252 255.255.255.0 //配置IP地址
[coresw1-Vlanif10] interface Vlanif100
[coresw1-Vlanif100] ip address 192.168.100.1 255.255.255.252

[coresw1-Vlanif100] interface GigabitEthernet0/0/1
[coresw1-GigabitEthernet0/0/1] port link-type trunk
[coresw1-GigabitEthernet0/0/1] port trunk allow-pass vlan all
[coresw1-GigabitEthernet0/0/1] interface GigabitEthernet0/0/3
[coresw1-GigabitEthernet0/0/3] port link-type trunk
[coresw1-GigabitEthernet0/0/3] port trunk allow-pass vlan all

[coresw1-GigabitEthernet0/0/3] interface GigabitEthernet0/0/2
[coresw1-GigabitEthernet0/0/2] port link-type access
[coresw1-GigabitEthernet0/0/2] port default vlan 100
```

配置 coresw2：

```text
<Huawei> system-view
[Huawei] sysname coresw2
[coresw2] vlan batch 10 200
[coresw2] interface Vlanif10
[coresw2-Vlanif10] ip address 192.168.10.253 255.255.255.0
[coresw2-Vlanif10] interface Vlanif200
[coresw2-Vlanif200] ip address 192.168.200.1 255.255.255.252
[coresw2-Vlanif200] interface GigabitEthernet0/0/1
[coresw2-GigabitEthernet0/0/1] port link-type trunk
[coresw2-GigabitEthernet0/0/1] port trunk allow-pass vlan all
[coresw2-GigabitEthernet0/0/1] interface GigabitEthernet0/0/2
[coresw2-GigabitEthernet0/0/2] port link-type access
[coresw2-GigabitEthernet0/0/2] port default vlan 200
[coresw2-GigabitEthernet0/0/2] interface GigabitEthernet0/0/3
[coresw2-GigabitEthernet0/0/3] port link-type trunk
[coresw2-GigabitEthernet0/0/3] port trunk allow-pass vlan all
[coresw2-GigabitEthernet0/0/3] quit
[coresw2]
```

出口路由器 router 配置：

```text
<Huawei> system-view
[Huawei] sysname router
[router] interface GigabitEthernet0/0/0
[router-GigabitEthernet0/0/0] ip address 100.1.1.2 255.255.255.252
[router-GigabitEthernet0/0/0] interface GigabitEthernet0/0/1
[router-GigabitEthernet0/0/1] ip address 192.168.100.2 255.255.255.252
[router-GigabitEthernet0/0/1] interface GigabitEthernet0/0/2
[router-GigabitEthernet0/0/2] ip address 192.168.200.2 255.255.255.252
[router-GigabitEthernet0/0/2] quit
[router]
```

### 2、配置路由互通

核心交换机 coresw1 配置默认路由，下一跳指向出口路由器。

```text
[coresw1] ip route-static 0.0.0.0 0.0.0.0 192.168.100.2
```

核心交换机 coresw2 配置默认路由，下一跳指向出口路由器。

```text
[coresw2] ip route-static 0.0.0.0 0.0.0.0 192.168.200.2
```

出口路由器 router 配置默认路由，下一跳指向运营商，并配置静态内网网段的静态路由，下一跳分别指向两台核心交换机。

```text
[router] ip route-static 0.0.0.0 0.0.0.0 100.1.1.1
[router] ip route-static 192.168.10.0 255.255.255.0 192.168.100.1
[router] ip route-static 192.168.10.0 255.255.255.0 192.168.200.1
```

internet 配置默认路由，下一跳指向出口路由器。

```text
[internet] ip route-static 0.0.0.0 0.0.0.0 100.1.1.2
```

### 3、配置 VRRP 实现网关冗余与切换

核心交换机 coresw1 VRRP 配置（Master）：

```text
[coresw1] interface Vlanif 10 //进入Vlanif 10（写成vlanif10也行）
[coresw1-Vlanif10] vrrp vrid 10 virtual-ip 192.168.10.254 //配置VRRP虚拟路由器10，虚拟IP地址是192.168.10.254
[coresw1-Vlanif10] vrrp vrid 10 priority 120 //虚拟路由器10的优先级设置为120
[coresw1-Vlanif10] vrrp vrid 10 preempt-mode timer delay 20 //抢占延时设置为20秒。比如以前该设备是备份设备，调整优先级后成为优先级最高的设备，不会马上成为Master，需要延时20秒，再抢占成为Master。
```

核心交换机 coresw2 VRRP 配置（Backup）：

```text
[coresw2] interface Vlanif 10 //进入Vlanif 10
[coresw2-Vlanif10] vrrp vrid 10 virtual-ip 192.168.10.254 //配置VRRP虚拟路由器10，虚拟IP地址是192.168.10.254，优先级默认是100
```

> 注意：原文这一段是 coresw2 的配置，但提示符写作 `[coresw1]` / `[coresw1-Vlanif10]`，已改为 coresw2。

在核心交换机 coresw2 上查看 VRRP 状态，这台设备处于 Backup 备份状态（coresw1 优先级是 120，coresw2 默认优先级 100，故 coresw1 由于优先级更高，处于 Master 状态）。

```text
[coresw2] display vrrp brief
VRID  State        Interface                Type     Virtual IP
----------------------------------------------------------------
10    Backup       Vlanif10                 Normal   192.168.10.254
----------------------------------------------------------------
Total:1     Master:0     Backup:1     Non-active:0
```

### 4、测试验证

PC 可以 ping 通互联网地址 100.1.1.1。

```text
PC> ping 100.1.1.1
  round-trip min/avg/max = 0/74/125 ms
Ping 100.1.1.1: 32 data bytes, Press Ctrl_C to break
Request timeout!
From 100.1.1.1: bytes=32 seq=2 ttl=253 time=125 ms
From 100.1.1.1: bytes=32 seq=3 ttl=253 time=47 ms
From 100.1.1.1: bytes=32 seq=4 ttl=253 time=47 ms
From 100.1.1.1: bytes=32 seq=5 ttl=253 time=78 ms

--- 100.1.1.1 ping statistics ---
  5 packet(s) transmitted
  4 packet(s) received
  20.00% packet loss
```

跟踪 PC 访问路径，下一跳是 192.168.10.252，即流量从 coresw1 出去。

```text
PC> tracert 100.1.1.1
traceroute to 100.1.1.1, 8 hops max
(ICMP), press Ctrl+C to stop
 1  192.168.10.252   47 ms  47 ms  31 ms
 2  192.168.100.2   110 ms  46 ms  32 ms
 3  100.1.1.1   62 ms  94 ms  62 ms
```

在核心交换机 coresw2 上，把 VRRP 优先级修改为 200，比 coresw1 的 120 优先级更大，那么 coresw2 将成为 Master。

```text
[coresw2] interface Vlanif 10 //进入接口Vlanif 10
[coresw2-Vlanif10] vrrp vrid 10 priority 200 //VRRP虚拟路由器10优先级设置为200
Oct  8 2021 22:04:35-08:00 coresw2 %%01VRRP/4/STATEWARNINGEXTEND(l)[0]:Virtual Router state BACKUP changed to MASTER, because of priority calculation. (Interface=Vlanif10, VrId=10, InetType=IPv4) //提示BACKUP已经转换为MASTER
```

在核心交换机 coresw2 上验证 VRRP 状态，coresw2 已经成为 Master。

```text
[coresw2] display vrrp brief
VRID  State        Interface                Type     Virtual IP
----------------------------------------------------------------
10    Master       Vlanif10                 Normal   192.168.10.254
----------------------------------------------------------------
Total:1     Master:1     Backup:0     Non-active:0
```

PC 上跟踪访问路径，下一跳已经变为 192.168.10.253，即 coresw2。

```text
PC> tracert 100.1.1.1
traceroute to 100.1.1.1, 8 hops max
(ICMP), press Ctrl+C to stop
 1  192.168.10.253   31 ms  32 ms  46 ms
 2  192.168.200.2   63 ms  62 ms  63 ms
 3  100.1.1.1   78 ms  94 ms  78 ms
```
