---
title: 部署 Roundcube + Postfix + Dovecot + SSL
date: 2026-10-10
categories: [Linux, Debian,邮件服务]
tags: [Postfix, Dovecot, Roundcube, SSL, Debian]
description: 在 Debian 上用 Postfix 收发邮件、Dovecot 提供 IMAPS/POP3S 与 SASL 认证、Roundcube 做 Webmail，全程 SSL 加密。
---

# 部署 Roundcube + Postfix + Dovecot + SSL

本文记录在 Debian 上搭建一套完整邮件服务的过程：

| 组件 | 作用 | 端口 |
| --- | --- | --- |
| Postfix | SMTP 发信 / 收信 | 25、587（submission）、465（smtps） |
| Dovecot | IMAP / POP3 取信，并为 Postfix 提供 SASL 认证 | 993（imaps）、995（pop3s） |
| Roundcube | 网页邮箱客户端 | 80 / 443 |

示例环境：域名 `cmcc.cn`，邮件主机 `mail.cmcc.cn`，证书 `/etc/ssl/private/mail.crt`、私钥 `/etc/ssl/private/mail.key`，CA 证书在 `/etc/ssl/myca/`。

<!-- more -->

## 一、安装软件包

```bash
apt install postfix dovecot-* -y
```

## 二、配置 Postfix

### 1. 主配置 `/etc/postfix/main.cf`

> Postfix 配置文件只支持以 `#` 开头的整行注释，**不能在行尾写注释**，否则会被当成参数值的一部分。

```ini
# ---------- 基础 ----------
# SMTP 欢迎横幅，$myhostname、$mail_name 为内置变量
smtpd_banner = $myhostname ESMTP $mail_name (Debian/GNU)
# 关闭新邮件提醒（biff）
biff = no
# 不自动在本地地址后追加 .$mydomain
append_dot_mydomain = no
# 邮件延迟超过 4 小时发送警告（默认关闭）
#delay_warning_time = 4h
readme_directory = no
# 兼容级别，使用 3.6 版本的默认行为
compatibility_level = 3.6

# ---------- 主机与域名 ----------
myhostname = mail.cmcc.cn
mydomain = cmcc.cn
# 发件地址的域名，从 /etc/mailname 读取
myorigin = /etc/mailname
# 本机负责接收的域名
mydestination = $myhostname, mail.$mydomain, $mydomain
# 不使用上游中继
relayhost =
# 信任的网络（实验环境写法，见文末注意事项）
mynetworks = 0.0.0.0/0
inet_interfaces = all
# 同时使用 IPv4 和 IPv6（只用 IPv4 请写 ipv4）
inet_protocols = all

# ---------- 邮箱 ----------
# 使用 Maildir 格式，存放在用户家目录的 Maildir/ 下
home_mailbox = Maildir/
# 0 表示不限制邮箱大小
mailbox_size_limit = 0
# 地址扩展分隔符，如 user1+tag@cmcc.cn
recipient_delimiter = +
alias_maps = hash:/etc/aliases
alias_database = hash:/etc/aliases

# ---------- TLS：作为服务端（接收连接） ----------
smtpd_use_tls = yes
smtpd_tls_cert_file = /etc/ssl/private/mail.crt
smtpd_tls_key_file = /etc/ssl/private/mail.key
# 强制客户端使用 TLS
smtpd_tls_security_level = encrypt
smtpd_tls_session_cache_database = btree:${data_directory}/smtpd_scache

# ---------- TLS：作为客户端（向外投递） ----------
# 用来校验对方服务器证书的 CA
smtp_tls_CAfile = /etc/ssl/myca/mail.crt
smtp_tls_security_level = encrypt
smtp_tls_session_cache_database = btree:${data_directory}/smtp_scache

# ---------- SASL 认证（交给 Dovecot） ----------
smtpd_sasl_type = dovecot
# 对应 Dovecot 的 /var/spool/postfix/private/auth 套接字
smtpd_sasl_path = private/auth
smtpd_sasl_auth_enable = yes
# 禁止匿名认证
smtpd_sasl_security_options = noanonymous
smtpd_sasl_local_domain = $myhostname

# ---------- 访问控制 ----------
# 收件人限制：信任网络、发往本域、已认证用户放行，其余拒绝
smtpd_recipient_restrictions = permit_mynetworks, permit_auth_destination, permit_sasl_authenticated, reject
# 中继限制：信任网络、已认证用户可中继，其他非本域目标延迟拒绝
smtpd_relay_restrictions = permit_mynetworks, permit_sasl_authenticated, defer_unauth_destination
```

### 2. 服务配置 `/etc/postfix/master.cf`

开启 25、587（STARTTLS 提交）和 465（SSL 直连提交）三个入口。`-o` 参数行必须以空格开头，并紧跟在所属服务下面。

```ini
# ==========================================================================
# service    type  private unpriv  chroot  wakeup  maxproc command + args
# ==========================================================================
# 25 端口：服务器之间收发
smtp       inet  n       -       y       -       -       smtpd

# 587 端口：客户端提交邮件（STARTTLS，必须认证）
submission inet  n       -       y       -       -       smtpd
  -o syslog_name=postfix/submission
  -o smtpd_tls_security_level=encrypt
  -o smtpd_sasl_auth_enable=yes
  -o smtpd_tls_auth_only=yes
  -o smtpd_reject_unlisted_recipient=no
  -o smtpd_recipient_restrictions=permit_sasl_authenticated,reject
  -o milter_macro_daemon_name=ORIGINATING

# 465 端口：客户端提交邮件（SSL 直连，Roundcube 使用）
smtps      inet  n       -       y       -       -       smtpd
  -o syslog_name=postfix/smtps
  -o smtpd_tls_wrappermode=yes
  -o smtpd_sasl_auth_enable=yes
  -o smtpd_reject_unlisted_recipient=no
  -o smtpd_recipient_restrictions=permit_sasl_authenticated,reject
  -o milter_macro_daemon_name=ORIGINATING
```

| 参数 | 含义 |
| --- | --- |
| `syslog_name` | 日志中显示的服务名，便于区分端口 |
| `smtpd_tls_security_level=encrypt` | 强制 TLS |
| `smtpd_tls_wrappermode=yes` | 连接建立即走 SSL（465 端口必需） |
| `smtpd_tls_auth_only=yes` | 只有在 TLS 之后才允许认证 |
| `smtpd_reject_unlisted_recipient=no` | 不因收件人不在列表中而拒绝 |
| `permit_sasl_authenticated,reject` | 只允许已认证用户发信 |
| `milter_macro_daemon_name=ORIGINATING` | 标记为本地用户发出的邮件 |

## 三、配置 Dovecot

Dovecot 的注释同样用 `#`。

### 1. `/etc/dovecot/dovecot.conf`

```ini
# 监听所有 IPv4 和 IPv6 地址
listen = *, ::
```

### 2. `/etc/dovecot/conf.d/10-auth.conf`

```ini
# 禁止未加密的明文认证
disable_plaintext_auth = yes
# 认证机制，login 用于兼容 Outlook 等客户端
auth_mechanisms = plain login
```

### 3. `/etc/dovecot/conf.d/10-mail.conf`

```ini
# 与 Postfix 的 home_mailbox = Maildir/ 保持一致
mail_location = maildir:~/Maildir
#mail_location = mbox:~/mail:INBOX=/var/mail/%u
```

### 4. `/etc/dovecot/conf.d/10-master.conf`

```ini
service imap-login {
  # 关闭明文 IMAP（143）
  inet_listener imap {
    port = 0
  }
  # 保留 IMAPS，默认 993
  inet_listener imaps {
  }
}

service pop3-login {
  # 关闭明文 POP3（110）
  inet_listener pop3 {
    port = 0
  }
  # 保留 POP3S，默认 995
  inet_listener pop3s {
  }
}

service auth {
  unix_listener auth-userdb {
    #mode = 0666
    #user =
    #group =
  }

  # 给 Postfix 用的 SASL 认证套接字
  unix_listener /var/spool/postfix/private/auth {
    mode = 0666
    user = postfix
    group = postfix
  }

  # ……其余保持默认
}
```

### 5. `/etc/dovecot/conf.d/10-ssl.conf`

```ini
ssl = yes
# 路径前的 < 表示读取文件内容
ssl_cert = </etc/ssl/private/mail.crt
ssl_key = </etc/ssl/private/mail.key
```

## 四、添加本地邮件用户

邮件用户就是系统用户，禁止其登录 shell：

```bash
useradd -m user1 -s /sbin/nologin
passwd user1
```

> 加上 `-m` 才会创建家目录，否则邮件没有地方存放 `Maildir/`。

## 五、重启并检查服务

```bash
systemctl restart postfix dovecot
ss -lntp | grep -E ':(25|465|587|993|995)\b'
```

## 六、配置 Roundcube

### 1. 配置文件 `/etc/roundcube/config.inc.php`

只列出需要修改的部分，其余保持默认：

```php
<?php
$config = [];

// 数据库连接（建议用 dpkg-reconfigure roundcube-core 生成）
$config['db_dsnw'] = 'mysql://roundcube:<数据库密码>@localhost/roundcube';

// IMAP：通过 993 端口 SSL 收信
$config['imap_host'] = ["ssl://mail.cmcc.cn:993"];

// SMTP：通过 465 端口 SSL 发信，%u / %p 表示使用当前登录用户的账号密码
$config['smtp_host'] = 'ssl://mail.cmcc.cn:465';
$config['smtp_user'] = '%u';
$config['smtp_pass'] = '%p';

$config['support_url'] = '';
$config['product_name'] = 'Roundcube';

// 连接 IMAP 时校验服务器证书
$config['imap_conn_options'] = [
    'ssl' => [
        'verify_peer'  => true,
        'verify_depth' => 3,
        'cafile'       => '/etc/ssl/myca/ca.cert',  // CA 证书
    ],
];

// 连接 SMTP 时校验服务器证书
$config['smtp_conn_options'] = [
    'ssl' => [
        'verify_peer'  => true,
        'verify_depth' => 3,
        'cafile'       => '/etc/ssl/myca/ca.cert',  // CA 证书
    ],
];

// 加密会话中 IMAP 密码的密钥，必须正好 24 个字符，且不要用示例值
$config['des_key'] = '<24位随机字符串>';

$config['plugins'] = [
    // 'archive',
    // 'zipdownload',
];

$config['skin'] = 'elastic';
$config['enable_spellcheck'] = false;
```

生成 24 位随机密钥：

```bash
openssl rand -base64 18
```

### 2. 导入数据库

```bash
cd /usr/share/roundcube/SQL
mysql roundcube < mysql.initial.sql
```

## 注意事项

- `mynetworks = 0.0.0.0/0` 会把所有 IP 当作可信网络，等于**开放中继**，只适合实验环境。生产环境请改为 `127.0.0.0/8 [::1]/128`，外部用户通过 587/465 认证发信。
- Postfix 证书 `mail.crt` 必须由 `/etc/ssl/myca/ca.cert` 签发，且证书中的域名要与 `mail.cmcc.cn` 一致，否则 Roundcube 开启 `verify_peer` 后会连接失败。
- 证书私钥建议权限为 `600`：`chmod 600 /etc/ssl/private/mail.key`。
