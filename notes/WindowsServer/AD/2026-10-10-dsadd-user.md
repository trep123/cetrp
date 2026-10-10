---
title: dsadd user 命令详解与批量创建 AD 用户
date: 2026-10-10
tags: [Windows Server, Active Directory, dsadd, 批处理]
description: dsadd user 常用参数速查，以及用 FOR /F 读取 CSV 批量创建 AD 域用户。
---

# dsadd user 命令详解与批量创建 AD 用户

`dsadd user` 用于在 Active Directory（AD）中创建用户账户。需要**域管理员**（或对目标 OU 有创建权限的账户），在域控制器或已安装 RSAT 工具的计算机上运行。

<!-- more -->

## 一、基本语法

```cmd
dsadd user <UserDN> [参数]
```

`<UserDN>` 是用户的 Distinguished Name（可分辨名称），格式为：

```text
CN=用户名,OU=组织单位,DC=域名,DC=后缀
```

例如 `CN=John,OU=Sales,DC=contoso,DC=com`。DN 中含空格时要用双引号括起来。

## 二、常用参数

### 1. 账户基本信息

| 参数 | 说明 | 示例 |
| --- | --- | --- |
| `-samid <SAM名>` | SAM 账户名，即旧式登录名 | `john` |
| `-upn <UPN>` | 用户主体名称，即新式登录名 | `john@contoso.com` |
| `-fn <名>` | 名（First Name） | `John` |
| `-mi <缩写>` | 中间名缩写 | `M` |
| `-ln <姓>` | 姓（Last Name） | `Doe` |
| `-display <显示名>` | 显示名称 | `"John Doe"` |
| `-empid <工号>` | 员工编号 | `10086` |

### 2. 密码与安全

| 参数 | 说明 | 默认值 |
| --- | --- | --- |
| `-pwd <密码>` | 初始密码，需符合域密码策略；写 `*` 会提示输入 | — |
| `-mustchpwd {yes\|no}` | 下次登录时必须更改密码 | `no` |
| `-canchpwd {yes\|no}` | 用户能否更改密码 | `yes` |
| `-pwdneverexpires {yes\|no}` | 密码永不过期 | `no` |
| `-disabled {yes\|no}` | 创建后禁用账户 | `no` |
| `-acctexpires <天数>` | 账户在多少天后过期；`0` 表示今天结束时过期，`never` 表示永不过期 | `never` |

### 3. 组织与联系信息

| 参数 | 说明 |
| --- | --- |
| `-desc <描述>` | 描述 |
| `-office <办公室>` | 办公室 |
| `-tel <电话>` | 电话 |
| `-mobile <手机>` | 手机 |
| `-email <邮箱>` | 电子邮件 |
| `-title <职务>` | 职务 |
| `-dept <部门>` | 部门 |
| `-company <公司>` | 公司 |
| `-memberof <组DN ...>` | 加入指定组，填组的 DN，多个组用空格分隔 |

### 4. 主目录、配置文件与登录脚本

| 参数 | 说明 | 示例 |
| --- | --- | --- |
| `-hmdir <路径>` | 主目录（UNC 路径） | `\\server\home\$username$` |
| `-hmdrv <盘符>` | 主目录映射的盘符 | `H:` |
| `-profile <路径>` | 漫游配置文件路径 | `\\server\profiles\$username$` |
| `-loscr <脚本>` | 登录脚本 | `logon.bat` |

> `$username$` 是 dsadd 自带的占位符，会替换成 `-samid` 的值，必须同时指定 `-samid` 才生效。

## 三、示例

### 示例 1：创建基础用户

```cmd
dsadd user "CN=John,OU=Sales,DC=contoso,DC=com" -samid john -upn john@contoso.com -fn John -ln Doe -display "John Doe" -pwd P@ssw0rd -mustchpwd yes
```

创建用户 John，登录名为 `john`，初始密码 `P@ssw0rd`，下次登录必须修改密码。

### 示例 2：创建禁用账户

```cmd
dsadd user "CN=Jane,OU=IT,DC=contoso,DC=com" -samid jane -pwd P@ssw0rd -disabled yes
```

### 示例 3：带主目录和配置文件

```cmd
dsadd user "CN=Bob,OU=HR,DC=contoso,DC=com" -samid bob -pwd P@ssw0rd -hmdir \\fileserver\home\$username$ -hmdrv H: -profile \\fileserver\profiles\$username$
```

为 Bob 分配主目录（映射为 `H:`）和漫游配置文件。

## 四、用 CSV 批量创建用户

### 1. 准备 CSV

文件 `C:\users.csv`，每行一个用户，用英文逗号分隔，共 13 列：

| 列 | 变量 | 含义 | 示例 |
| --- | --- | --- | --- |
| 1 | `%a` | 用户名（CN，也用作 UPN 前缀） | `zhangsan` |
| 2 | `%b` | 姓 | `张` |
| 3 | `%c` | 名 | `三` |
| 4 | `%d` | 公司 | `WSC` |
| 5 | `%e` | 邮箱 | `zhangsan@wsc39.test` |
| 6 | `%f` | 职务 | `工程师` |
| 7 | `%g` | 描述（后半部分） | `技术部` |
| 8 | `%h` | 电话 | `010-12345678` |
| 9 | `%i` | SAM 登录名 | `zhangsan` |
| 10 | `%j` | 初始密码 | `P@ssw0rd` |
| 11 | `%k` | 所属组 | `HQ-Users` |
| 12 | `%l` | 所在 OU（组也在这个 OU 下） | `HQ` |
| 13 | `%m` | 描述（前半部分） | `总部` |

```text
zhangsan,张,三,WSC,zhangsan@wsc39.test,工程师,技术部,010-12345678,zhangsan,P@ssw0rd,HQ-Users,HQ,总部
```

### 2. 批量创建命令

直接在 cmd 窗口中执行：

```cmd
for /f "tokens=1-13 delims=," %a in (C:\users.csv) do dsadd user "cn=%a,ou=%l,dc=wsc39,dc=test" -ln "%b" -fn "%c" -company "%d" -email "%e" -title "%f" -tel "%h" -samid "%i" -pwd "%j" -upn %a@wsc39.test -profile \\wsc39.test\HQ\users\profiles\%a -memberof "cn=%k,ou=%l,dc=wsc39,dc=test" -desc "%m%g"
```

参数对应关系：

| dsadd 参数 | 取值 |
| --- | --- |
| UserDN | `cn=%a,ou=%l,dc=wsc39,dc=test` |
| `-ln` / `-fn` | `%b` / `%c` |
| `-company` | `%d` |
| `-email` | `%e` |
| `-title` | `%f` |
| `-tel` | `%h` |
| `-samid` | `%i` |
| `-pwd` | `%j` |
| `-upn` | `%a@wsc39.test` |
| `-profile` | `\\wsc39.test\HQ\users\profiles\%a` |
| `-memberof` | `cn=%k,ou=%l,dc=wsc39,dc=test` |
| `-desc` | `%m%g`，即两列拼接，如「总部技术部」 |

### 3. 批处理中的写法

写进 `.bat` 文件时，变量要写成两个百分号：

```bat
@echo off
for /f "skip=1 tokens=1-13 delims=," %%a in (C:\users.csv) do (
  dsadd user "cn=%%a,ou=%%l,dc=wsc39,dc=test" -ln "%%b" -fn "%%c" -company "%%d" -email "%%e" -title "%%f" -tel "%%h" -samid "%%i" -pwd "%%j" -upn %%a@wsc39.test -profile \\wsc39.test\HQ\users\profiles\%%a -memberof "cn=%%k,ou=%%l,dc=wsc39,dc=test" -desc "%%m%%g"
)
pause
```

### 4. 批量创建的注意事项

- **首行是表头**时加 `skip=1` 跳过。
- **不要有空字段**：`for /f` 会把连续的逗号当成一个分隔符，某列为空时后面的列会整体错位。
- **中文乱码**：CSV 用 ANSI（GBK）编码保存，或先执行 `chcp 65001` 并保存为 UTF-8（无 BOM）。
- **OU 和组要先存在**：`-memberof` 指定的组不存在时，用户会创建成功，但加组会报错。
- **UPN 后缀**要写域名（如 `@wsc39.test`），或已在「AD 域和信任关系」中添加过的 UPN 后缀。
- **UNC 路径**：`\\wsc39.test\HQ` 写法依赖 DFS 命名空间；普通共享请写成 `\\服务器名\共享名`。

## 五、常见问题

1. **权限不足**：确认当前账户是 Domain Admins 成员，或对目标 OU 有「创建用户对象」的委派权限。
2. **DN 格式错误**：DN 中的逗号、等号不能多写空格；OU 必须真实存在，嵌套 OU 写成 `OU=子,OU=父`。
3. **密码不符合策略**：默认策略要求至少 7 位并包含大写、小写、数字、符号中的三类。
4. **对象已存在**：同一个 OU 下 CN 不能重复，整个域内 `samid` 和 `upn` 不能重复。

## 六、替代方案：PowerShell

需要更灵活的处理（如跳过已存在用户、写日志），推荐使用 `New-ADUser`：

```powershell
New-ADUser -Name "John" -SamAccountName "john" -UserPrincipalName "john@contoso.com" `
  -GivenName "John" -Surname "Doe" -Path "OU=Sales,DC=contoso,DC=com" -Enabled $true `
  -AccountPassword (ConvertTo-SecureString "P@ssw0rd" -AsPlainText -Force)
```

配合 CSV 批量创建（CSV 首行为表头）：

```powershell
Import-Csv C:\users.csv | ForEach-Object {
  New-ADUser -Name $_.Name -SamAccountName $_.Sam -UserPrincipalName "$($_.Name)@wsc39.test" `
    -Path "OU=$($_.OU),DC=wsc39,DC=test" -Enabled $true `
    -AccountPassword (ConvertTo-SecureString $_.Password -AsPlainText -Force)
}
```
