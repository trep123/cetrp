---
title: 分解实验04：DHCP原理及应用
date: 2026-10-11 11:55
tags: [软考, 网络工程师, 华为, DHCP]
description: 在华为路由器上分别用接口地址池和全局地址池两种方式配置 DHCP 服务器，包括 DNS、排除地址、网关和租期。
---

# 分解实验04：DHCP原理及应用

本实验把一台路由器配置成 DHCP 服务器端，分两个场景演示：场景 1 基于接口地址池分配地址，场景 2 创建全局地址池 test 并在接口下调用。

<!-- more -->

## 场景 1：DHCP 接口地址池配置

### 1、需求描述

配置一台路由器作为 DHCP 服务器端，使用接口 GE0/0/0 所属的网段作为 DHCP 客户端的地址池，同时将接口地址设为 DNS Server 地址，租期设置为 3 天。

### 2、网络拓扑

| 设备 | 接口 | IP/掩码 | 角色 |
| --- | --- | --- | --- |
| DHCP 客户端（PC） | — | 自动获取 | DHCP 客户端 |
| 路由器 | GE0/0/0 | 10.1.1.1/24 | DHCP 服务器端 |

```text
DHCP客户端 ──── (二层广播域) ──── GE0/0/0 10.1.1.1/24 [R] DHCP服务器端
```

### 3、DHCP 服务器配置

```text
[Huawei] dhcp enable //开启DHCP功能
[Huawei] interface GigabitEthernet0/0/0
[Huawei-GigabitEthernet0/0/0] dhcp select interface //配置基于接口的DHCP
[Huawei-GigabitEthernet0/0/0] dhcp server dns-list 10.1.1.2 //配置DNS
[Huawei-GigabitEthernet0/0/0] dhcp server excluded-ip-address 10.1.1.2 //配置排除地址
[Huawei-GigabitEthernet0/0/0] dhcp server lease day 3 //配置地址租期为3天
```

> **提示**：原文需求写的是「将接口地址设为 DNS Server 地址」（接口地址为 10.1.1.1），但命令中 DNS 和排除地址用的都是 10.1.1.2。这里按原图保留命令，若严格按需求，`dns-list` 应写接口地址 10.1.1.1。

## 场景 2：DHCP 全局地址池配置

### 1、需求描述

配置一台路由器作为 DHCP 服务器端，配置全局地址池 test 为 DHCP 客户端分配 IP 地址，分配地址为 1.1.1.0/24 网段，网关地址 1.1.1.1，DNS 地址同样也是 1.1.1.1，租期 10 天，在 GE0/0/0 接口下调用全局地址池。

### 2、网络拓扑

拓扑与场景 1 相同（原图中路由器 GE0/0/0 仍标注为 10.1.1.1/24）。

| 设备 | 接口 | IP/掩码 | 角色 |
| --- | --- | --- | --- |
| DHCP 客户端（PC） | — | 自动获取 | DHCP 客户端 |
| 路由器 | GE0/0/0 | 10.1.1.1/24（原图标注） | DHCP 服务器端 |

```text
DHCP客户端 ──── (二层广播域) ──── GE0/0/0 10.1.1.1/24 [R] DHCP服务器端
```

> **提示**：全局地址池网段是 1.1.1.0/24、网关是 1.1.1.1，而原图拓扑中接口标的是 10.1.1.1/24。实际做实验时，GE0/0/0 的地址要与地址池同网段（如 1.1.1.1/24），客户端才能从该接口的全局地址池拿到地址。

### 3、DHCP 服务器核心配置

```text
[Huawei] dhcp enable
[Huawei] ip pool test //配置名称为test的DHCP地址池
Info: It's successful to create an IP address pool. //提示成功创建了地址池
[Huawei-ip-pool-test] network 1.1.1.0 mask 24 //宣告DHCP地址池网段
[Huawei-ip-pool-test] gateway-list 1.1.1.1 //宣告网关
[Huawei-ip-pool-test] dns-list 1.1.1.1 //宣告DNS地址
[Huawei-ip-pool-test] lease day 10 //配置地址租期为10天
[Huawei-ip-pool-test] quit
[Huawei] interface GigabitEthernet0/0/0
[Huawei-GigabitEthernet0/0/0] dhcp select global //在接口下应用全局地址池
```

> 注意：原文地址池视图提示符写作 `[Huawei-ip-pool-pool2]`，与上面创建的地址池名 test 不一致，已改为 `[Huawei-ip-pool-test]`；原文接口视图提示符写作 `[Huawei-GigabitEthernet0/0/1]`，与进入的 GigabitEthernet0/0/0 不一致，已改为 0/0/0。

`dhcp select global` 的说明（原文注释）：如果有多个 DHCP 地址池，会首先判断终端用户属于哪个 VLAN，最终使用该 VLANIF 相同网段的地址池。比如 DHCP 服务器配置了 TEST1 和 TEST2 两个地址池分别是 192.168.10.0/24 和 192.168.20.0/24，用户网关分别是 VLANIF10：192.168.10.254 和 VLANIF20：192.168.20.254。如果终端属于 VLAN10，那么会给该终端分配与 VLANIF10：192.168.10.254 相同网段的地址池，即地址池 TEST1。
