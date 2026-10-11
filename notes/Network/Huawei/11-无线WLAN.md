---
title: 分解实验11：无线WLAN
date: 2026-10-11 11:48
tags: [软考, 网络工程师, 华为, WLAN]
description: 在 AC6605 上完成 AP 上线（MAC 认证），用隧道转发为内部办公 SSID work（VLAN101）提供无线接入，再用直接转发为访客 SSID guest（VLAN102）提供无线接入。
---

# 分解实验11：无线WLAN

本实验用“核心交换机 + 接入交换机 + AC6605 + 2 台 AP”的组网，先配置交换机、路由器和 AC 的基础参数并让 AP 上线，再分别以隧道转发模式（内部用户 SSID work）和直接转发模式（访客 SSID guest）下发无线业务。

<!-- more -->

## 1、实验拓扑

拓扑连线如下：

```text
                    Router
                      | GE0/0/0  192.168.200.2/30
                      |
                      | GE0/0/3
                     SW1 GE0/0/2 ------------ GE0/0/1 AC6605（管理Vlanif100：192.168.100.254/24）
  业务Vlanif101：192.168.101.254/24
  业务Vlanif102：192.168.102.254/24
  互联Vlanif200：192.168.200.1/30
                      | GE0/0/1
                      |
                      | GE0/0/3
                     SW2
            GE0/0/1 /     \ GE0/0/2
                   /       \
          GE0/0/0 /         \ GE0/0/0
               AP1           AP2
          （无线终端：笔记本、平板、手机）
```

| 设备 | 接口 | IP 地址/端口状态 | 备注 |
| --- | --- | --- | --- |
| Router | G0/0/0 | 192.168.200.2/30 | - |
| SW1 | G0/0/1 | trunk | - |
| SW1 | G0/0/2 | trunk | - |
| SW1 | G0/0/3 | access（VLAN200） | - |
| SW1 | Vlanif101 | 192.168.101.254/24 | VLAN101 是内部办公用户（work） |
| SW1 | Vlanif102 | 192.168.102.254/24 | VLAN102 是访客用户（guest） |
| SW1 | Vlanif200 | 192.168.200.1/30 | VLAN200 用于出口互联 |
| SW2 | G0/0/1 | trunk | - |
| SW2 | G0/0/2 | trunk | - |
| SW2 | G0/0/3 | trunk | - |
| AC | G0/0/1 | trunk | - |
| AC | Vlanif100 | 192.168.100.254/24 | VLAN100 用于 AP 管理 |

## 2、需求描述

1. 配置隧道转发模式，完成 AP 上线，内部办公用户（VLAN101）能通过无线上网。
2. 访客（VLAN102）能通过无线上网，配置为直接转发模式。隧道转发与直接转发过程如下：

| 转发方式 | 说明 |
| --- | --- |
| 隧道转发方式 | 用户的数据报文到达 AP 后，需要经过 CAPWAP 数据隧道封装后发送给 AC，然后由 AC 再转发到上层网络。 |
| 直接转发方式 | 用户的数据报文到达 AP 后，不经过 CAPWAP 的隧道封装而直接转发到上层网络。 |

```text
隧道转发：终端 -> AP ==(CAPWAP隧道封装业务数据)==> 交换机 -> AC -> 上层网络
直接转发：终端 -> AP -> 交换机 -> 上层网络（AP 与 AC 之间的 CAPWAP 隧道只承载管理流量）
```

3. 管理 VLAN 100，业务 VLAN 101 和 102，VLAN 101 为内部用户提供上网服务（SSID：work），VLAN 102 为访客提供上网服务（SSID：guest）。AP 通过 AC DHCP 自动获取 IP 192.168.100.0/24 地址段的地址，用户通过 SW1 DHCP 自动分配对应网段的地址。

## 3、配置过程

### 第 1 步：核心交换机 SW1（VLAN、端口、Vlanif、DHCP）

（1）修改设备名，配置 VLAN

```text
<Huawei> system-view
[Huawei] sysname SW1
[SW1] vlan batch 100 101 102 200
```

（2）把相应接口配置成 trunk 或 access

```text
[SW1] interface GigabitEthernet0/0/1
[SW1-GigabitEthernet0/0/1] port link-type trunk
[SW1-GigabitEthernet0/0/1] port trunk allow-pass vlan 100
[SW1] interface GigabitEthernet0/0/2
[SW1-GigabitEthernet0/0/2] port link-type trunk
[SW1-GigabitEthernet0/0/2] port trunk allow-pass vlan all
[SW1-GigabitEthernet0/0/2] quit
[SW1] interface GigabitEthernet0/0/3
[SW1-GigabitEthernet0/0/3] port link-type access
[SW1-GigabitEthernet0/0/3] port default vlan 200
[SW1-GigabitEthernet0/0/3] quit
```

（3）接口配置 vlanif 地址

```text
[SW1] interface Vlanif101
[SW1-Vlanif101] ip address 192.168.101.254 24
[SW1] interface Vlanif102
[SW1-Vlanif102] ip address 192.168.102.254 24
[SW1] interface Vlanif200
[SW1-Vlanif200] ip address 192.168.200.1 30
```

（4）把 SW1 配置成 DHCP 服务器，为终端分配 IP 地址

```text
[SW1] dhcp enable //开启DHCP功能
[SW1] interface Vlanif101
[SW1-Vlanif101] dhcp select interface //配置基于接口的DHCP，为属于VLAN 101的终端分配与Vlanif101相同网段的IP地址
[SW1] interface Vlanif102
[SW1-Vlanif102] dhcp select interface //配置基于接口的DHCP，为属于VLAN 102的终端分配与Vlanif102相同网段的IP地址
```

### 第 2 步：配置接入交换机 SW2（VLAN、接口）

```text
<Huawei> system-view
[Huawei] sysname SW2
[SW2] vlan 100
[SW2] interface GigabitEthernet0/0/1
[SW2-GigabitEthernet0/0/1] port link-type trunk
[SW2-GigabitEthernet0/0/1] port trunk pvid vlan 100 //流量进入打上VLAN 100标签
[SW2-GigabitEthernet0/0/1] port trunk allow-pass vlan 100 //隧道模式，仅允许管理VLAN 100通过即可，数据都会被VLAN 100封装，转发到AC再拆封
[SW2-GigabitEthernet0/0/1] quit
[SW2] interface GigabitEthernet0/0/2
[SW2-GigabitEthernet0/0/2] port link-type trunk
[SW2-GigabitEthernet0/0/2] port trunk pvid vlan 100
[SW2-GigabitEthernet0/0/2] port trunk allow-pass vlan 100
[SW2-GigabitEthernet0/0/2] quit
[SW2] interface GigabitEthernet0/0/3
[SW2-GigabitEthernet0/0/3] port link-type trunk
[SW2-GigabitEthernet0/0/3] port trunk allow-pass vlan 100
```

### 第 3 步：配置路由器 Router

```text
<Huawei> system-view
[Huawei] sysname Router
[Router] interface GigabitEthernet0/0/0
[Router-GigabitEthernet0/0/0] ip address 192.168.200.2 30
[Router-GigabitEthernet0/0/0] quit
[Router] ping 192.168.200.1 //测试与核心交换机的直连,可以正常通信
  PING 192.168.200.1: 56  data bytes, press CTRL_C to break
    Reply from 192.168.200.1: bytes=56 Sequence=1 ttl=255 time=70 ms
    Reply from 192.168.200.1: bytes=56 Sequence=2 ttl=255 time=10 ms
    Reply from 192.168.200.1: bytes=56 Sequence=3 ttl=255 time=10 ms
    Reply from 192.168.200.1: bytes=56 Sequence=4 ttl=255 time=20 ms
    Reply from 192.168.200.1: bytes=56 Sequence=5 ttl=255 time=10 ms

  --- 192.168.200.1 ping statistics ---
    5 packet(s) transmitted
    5 packet(s) received
    0.00% packet loss
    round-trip min/avg/max = 10/24/70 ms

[Router] ip route-static 192.168.101.0 24 192.168.200.1 //配置内网网段静态路由，指向核心
[Router] ip route-static 192.168.102.0 24 192.168.200.1 //配置内网网段静态路由，指向核心
```

### 第 4 步：配置 AC 基础参数（VLAN、IP、DHCP）

```text
<AC6605> system-view
[AC6605] vlan batch 100 101 102 //批量创建VLAN 100、101、102（100是管理VLAN，101和102是业务VLAN）
Info: This operation may take a few seconds. Please wait for a moment...done.
[AC6605] interface GigabitEthernet0/0/1
[AC6605-GigabitEthernet0/0/1] port link-type trunk
[AC6605-GigabitEthernet0/0/1] port trunk allow-pass vlan all
[AC6605-GigabitEthernet0/0/1] quit
[AC6605] interface Vlanif100
[AC6605-Vlanif100] ip add 192.168.100.254 24

#开启DHCP功能，为AP分配IP地址
[AC6605] dhcp enable
[AC6605] interface Vlanif100
[AC6605-Vlanif100] dhcp select interface //为AP分配与Vlanif100相同网段的管理地址
```

### 第 5 步：在 AC 上配置 AP 上线（5 步）

① 创建域管理模版，并配置国家代码

```text
[AC6605] wlan
[AC6605-wlan-view] regulatory-domain-profile name china //配置域管理模版，名称是china
[AC6605-wlan-regulate-domain-china] country-code CN //配置国家代码,CN代表中国
```

② 创建 AP 组，并引用特定的域管理模版

```text
[AC6605] wlan
[AC6605-wlan-view] ap-group name jiaoxue //配置AP组，名称是jiaoxue
[AC6605-wlan-ap-group-jiaoxue] regulatory-domain-profile china //引用域管理模版china
Warning: Modifying the country code will clear channel, power and antenna gain configurations of the radio and reset the AP. Continue?[Y/N]:y //y表示确认
[AC6605-wlan-ap-group-jiaoxue] quit
[AC6605-wlan-view] quit
```

③ 配置 CAPWAP 隧道源接口或者源地址

```text
[AC6605] capwap source interface Vlanif 100 //CAPWAP隧道源地址是Vlanif 100地址
```

④ 配置 AP 设备入网认证

```text
[AC6605] wlan
[AC6605-wlan-view] ap auth-mode ? //AP上线有三种认证方式：MAC认证、不认证和SN码认证
  mac-auth   MAC authenticated mode, default authenticated mode
  no-auth    No authenticated mode
  sn-auth    SN authenticated mode
[AC6605-wlan-view] ap auth-mode mac-auth //配置AP通过MAC地址认证
[AC6605-wlan-view] ap-id 1 ap-mac 00e0-fc3f-7500 //输入需要认证AP1的MAC地址。可以在AP1上通过display interface GigabitEthernet0/0/0命令查看AP的MAC地址
[AC6605-wlan-ap-1] ap-name JX001 //把AP1命名为JX001
[AC6605-wlan-ap-1] ap-group jiaoxue //把AP加入jiaoxue组
Warning: This operation may cause AP reset. If the country code changes, it will clear channel, power and antenna gain configurations of the radio, Whether to continue? [Y/N]:y
```

⑤ 检查 AP 上线结果

```text
[AC6605] display ap all //查看AP上线情况，状态为nor（normal）表示正常的
Info: This operation may take a few seconds. Please wait for a moment.done.
Total AP information:
nor  : normal          [1]
---------------------------------------------------------------------------------
ID   MAC            Name    Group      IP               Type      State  STA  Uptime
---------------------------------------------------------------------------------
1    00e0-fc3f-7500 JX001   jiaoxue    192.168.100.211  AP6050DN  nor    0    40S
---------------------------------------------------------------------------------
Total: 1
//ID为1，名称为JX001，属于组jiaoxue，MAC是00e0-fc3f-7500，IP地址是192.168.100.211的AP，设备型号是AP6050DN，状态是nor（normal，正常），即AP完成上线。
```

> **注意**：原文注释写作“属于组 jiaoxuelou”，与上面配置和输出中的 AP 组名 jiaoxue 不一致，这里按 jiaoxue 修正。

注：AP1 上查看 mac 地址（display interface GigabitEthernet0/0/0）。

```text
[Huawei] display interface GigabitEthernet0/0/0
GigabitEthernet0/0/0 current state : UP
Line protocol current state : UP
Description:HUAWEI, AP Series, GigabitEthernet0/0/0 Interface
Switch Port, PVID :    1, TPID : 8100(Hex), The Maximum Frame Length is 1800
IP Sending Frames' Format is PKTFMT_ETHNT_2, Hardware address is 00e0-fc3f-7500
```

AP 完成上线后，名字已经被自动修改为 JX001，无需手动配置。

```text
[Huawei]
===== CAPWAP LINK IS UP!!! =====
[JX001]
```

### 第 6 步：配置 AC 无线业务，配置完成后会自动下发到对应 AP（4 步）

① 配置用户认证方式

```text
[AC6605] wlan //进入wlan配置模式
[AC6605-wlan-view] security-profile name sec_work //安全模版，名称为sec_work
[AC6605-wlan-sec-prof-sec_work] security wpa-wpa2 psk pass-phrase a1234567 aes //采用WPA-WPA2方式认证，PSK表示预共享密码，简单理解就是通过密码方式认证，密码是a1234567，加密算法采用AES
```

> **注意**：原文注释写作“PKS 表示预共享密码”，命令中的关键字是 psk（Pre-Shared Key），这里改为 PSK。

② 配置 ssid 模版

```text
[AC6605] wlan //进入wlan配置模式
[AC6605-wlan-view] ssid-profile name profile_work //SSID模版，名称是profile_work
[AC6605-wlan-ssid-prof-profile_work] ssid work //SSID名称是work
```

③ 配置 VAP 模版，设置为隧道模式，配置用户 VLAN101，并绑定安全模版、SSID 模版

```text
[AC6605] wlan
[AC6605-wlan-view] vap-profile name vap_work //VAP模版名称是vap_work
[AC6605-wlan-vap-prof-vap_work] forward-mode tunnel //转发模式是隧道模式
[AC6605-wlan-vap-prof-vap_work] service-vlan vlan-id 101 //使用work这个VAP模版的用户服务VLAN是101，即所有连接到work这个VAP的用户被划分到VLAN 101
Info: This operation may take a few seconds, please wait.done.
[AC6605-wlan-vap-prof-vap_work] security-profile sec_work //调用安全模版sec_work
Info: This operation may take a few seconds, please wait.done.
[AC6605-wlan-vap-prof-vap_work] ssid-profile profile_work //调用SSID模版profile_work
Info: This operation may take a few seconds, please wait.done.
```

④ 在 AP 组中绑定 vap 模版

```text
[AC6605-wlan-view] ap-group name jiaoxue
[AC6605-wlan-ap-group-jiaoxue] vap-profile vap_work wlan 1 radio 0 //在AP组中，将指定的VAP模板引用到射频，一般radio 0表示2.4GHz，radio 1表示5GHz。
Info: This operation may take a few seconds, please wait...done.
[AC6605-wlan-ap-group-jiaoxue] vap-profile vap_work wlan 1 radio 1
Info: This operation may take a few seconds, please wait...done.
```

### 第 7 步：验证与测试

配置完成后，STA1 可以正常连接。原图为 eNSP 中 STA1 的“Vap 列表”界面截图，内容如下（IPv4 配置选择 DHCP）：

| SSID | 加密方式 | 状态 | VAP MAC | 信道 | 射频类型 |
| --- | --- | --- | --- | --- | --- |
| work | NULL | 未连接 | 00-E0-FC-3F-75-00 | 1 | 802.11bgn |
| work | NULL | 已连接 | 00-E0-FC-3F-75-10 | 149 | |

查看分配的 IP 地址，正常获取 VLAN101 的地址。

```text
STA1> ipconfig
IPv4 address. . . . : 192.168.101.253
Subnet mask. . ... .: 255.255.255.0
Gateway. . . . ... ...: 192.168.101.254
Physical address. . ..: 54-89-98-EB-74-CD
```

STA1 可以 ping 通出口路由器 Router，实验成功。

```text
STA> ping 192.168.200.2
Ping 192.168.200.2: 32 data bytes, Press Ctrl_C to break
From 192.168.200.2: bytes=32 seq=1 ttl=254 time=203 ms
From 192.168.200.2: bytes=32 seq=2 ttl=254 time=203 ms
From 192.168.200.2: bytes=32 seq=3 ttl=254 time=187 ms
From 192.168.200.2: bytes=32 seq=4 ttl=254 time=172 ms
From 192.168.200.2: bytes=32 seq=5 ttl=254 time=172 ms
```

以上实验配置隧道模式，顺利达到实验效果。

## 4、扩展：访客 VLAN102 采用直接转发模式

如果把 AP1 下的访客用户（SSID：guest）划分到 VLAN 102，访客业务（VLAN 102）采用直接转发模式，需要进行如下配置：

1. 接入交换机 SW2 需要创建业务 VLAN 102，且 trunk 接口允许该 VLAN 通过。核心交换机与接入交换机互联的 trunk 接口，允许业务 VLAN 102 通过。
2. 新增一个 SSID：guest，属于 VLAN102，AC 配置 vap_guest 为直接转发。

### 交换机 trunk 允许通过的 VLAN 新增业务 VLAN 102

```text
[SW1] interface GigabitEthernet0/0/1
[SW1-GigabitEthernet0/0/1] port trunk allow-pass vlan 100 102
```

```text
[SW2] vlan 102 //隧道模式SW2只需要创建vlan 100，而直接转发模式SW2还需要创建VLAN 102
[SW2] interface GigabitEthernet0/0/3
[SW2-GigabitEthernet0/0/3] port trunk allow-pass vlan 100 102
[SW2-GigabitEthernet0/0/3] quit
[SW2] interface GigabitEthernet0/0/1
[SW2-GigabitEthernet0/0/1] port trunk allow-pass vlan 100 102 //放行管理VLAN 100和访客业务VLAN 102的流量
```

### AC 新增 SSID guest 与直接转发的 VAP 模版

```text
<AC6605> system-view
[AC6605] wlan
[AC6605-wlan-view] ssid-profile name profile_guest //配置SSID模版，名称是profile_guest
[AC6605-wlan-ssid-prof-profile_guest] ssid guest
Info: This operation may take a few seconds, please wait.done.
[AC6605-wlan-ssid-prof-profile_guest] quit
[AC6605-wlan-view] vap-profile name vap_guest //配置VAP模版，名称是vap_guest
[AC6605-wlan-vap-prof-vap_guest] forward-mode direct-forward //采用直接转发模式
[AC6605-wlan-vap-prof-vap_guest] service-vlan vlan-id 102 //访客业务VLAN 102
Info: This operation may take a few seconds, please wait.done.
[AC6605-wlan-vap-prof-vap_guest] security-profile sec_work //引用安全模版sec_work，访客跟内部人员使用一样的认证方式，实际项目跟进需要修改即可。
Info: This operation may take a few seconds, please wait.done.
[AC6605-wlan-vap-prof-vap_guest] ssid-profile profile_guest //引用SSID模版guest
Info: This operation may take a few seconds, please wait.done.
```

> **注意**：原文 quit 一行的提示符写作 [AC6605-wlan-ssid-prof-guest]，与上一行的 [AC6605-wlan-ssid-prof-profile_guest] 不一致，这里按 profile_guest 修正。

```text
[AC6605-wlan-vap-prof-vap_guest] quit

[AC6605-wlan-view] ap-group name jiaoxue
[AC6605-wlan-ap-group-jiaoxue] vap-profile vap_guest wlan 2 radio all //jiaoxue组中所有AP都开启一个叫vap_guest的虚拟AP，并开启虚拟AP所有的射频卡
```

> **注意**：原文第二行提示符中的 AP 组名与上一行进入的 AP 组 jiaoxue 不一致，这里按 jiaoxue 修正。

### 验证

STA1 上成功连接 SSID:guest。原图为 STA1 的“Vap 列表”截图（IPv4 配置选择 DHCP），内容如下：

| SSID | 加密方式 | 状态 | VAP MAC | 信道 | 射频类型 |
| --- | --- | --- | --- | --- | --- |
| work | NULL | 未连接 | 00-E0-FC-3F-75-00 | 1 | 802.11bgn |
| guest | NULL | 未连接 | 00-E0-FC-3F-75-01 | 1 | 802.11bgn |
| work | NULL | 未连接 | 00-E0-FC-3F-75-10 | 149 | |
| guest | NULL | 已连接 | 00-E0-FC-3F-75-11 | 149 | |

STA1 成功获取 VLAN102 的 IP 地址。

```text
STA1> ipconfig
IPv4 address. . . . . . . .: 192.168.102.253
Subnet mask... . . . . . . :255.255.255.0
Gateway. . . . . . . . . . :192.168.102.254
Physical address. . .... . .:54-89-98-EB-74-CD
```

STA1 可以成功 ping 通路由 Router，实验成功！

```text
STA> ping 192.168.200.2
Ping 192.168.200.2: 32 data bytes, Press Ctrl_C to break
From 192.168.200.2: bytes=32 seq=1 ttl=254 time=156 ms
From 192.168.200.2: bytes=32 seq=2 ttl=254 time=156 ms
From 192.168.200.2: bytes=32 seq=3 ttl=254 time=157 ms
From 192.168.200.2: bytes=32 seq=4 ttl=254 time=156 ms
From 192.168.200.2: bytes=32 seq=5 ttl=254 time=156 ms
```
