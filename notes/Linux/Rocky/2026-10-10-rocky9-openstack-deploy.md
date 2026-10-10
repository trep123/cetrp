---
title: Rocky Linux 9.6 部署 OpenStack 2024.2 Dalmatian 双节点
date: 2026-10-10
tags: [OpenStack, 云计算, Rocky Linux, Dalmatian, RDO]
description: 在 Rocky Linux 9.6 上用 RDO Dalmatian 仓库手动部署 controller + node1 双节点 OpenStack 2024.2，涵盖 Keystone、Glance、Placement、Nova、Neutron、Cinder 和 Horizon。
---

# Rocky Linux 9.6 部署 OpenStack 2024.2 Dalmatian 双节点

本文在两台 Rocky Linux 9.6 主机上，通过 `centos-release-openstack-dalmatian`（RDO）仓库手动部署 OpenStack 2024.2 Dalmatian（具体小版本以实际安装的软件包为准）。节点规划：`controller`（192.168.1.100）为控制节点，同时承担网络和块存储角色；`node1`（192.168.1.101）为计算节点。部署的组件包括 MariaDB、RabbitMQ、Memcached、etcd、Keystone、Glance、Placement、Nova、Neutron、Cinder 和 Horizon。

> **提示**：文中所有密码（`ChangeMe123`）都是示例，请在部署前统一替换成你自己的密码。

<!-- more -->

## 一、系统环境准备（两个节点都要执行）

### 1.1 设置主机名和 hosts 文件

**Controller 节点执行：**

```bash
hostnamectl set-hostname controller
cat > /etc/hosts << EOF
127.0.0.1     localhost
192.168.1.100 controller
192.168.1.101 node1
EOF
```

**Node1 节点执行：**

```bash
hostnamectl set-hostname node1
cat > /etc/hosts << EOF
127.0.0.1     localhost
192.168.1.100 controller
192.168.1.101 node1
EOF
```

**关闭防火墙和 SELinux（两个节点都执行）：**

```bash
systemctl disable firewalld --now
setenforce 0
sed -i 's/^SELINUX=.*/SELINUX=permissive/' /etc/selinux/config
```

✅ 验证：在 controller 执行 `ping node1`，应收到来自 192.168.1.101 的回复；在 node1 执行 `ping controller`，应收到来自 192.168.1.100 的回复。

### 1.2 配置 yum 源

两个节点执行完全相同的操作：先备份原有 repo 文件，再把 `rocky.repo` 替换成清华镜像的 CentOS Stream 9 源，然后安装 Dalmatian 仓库。

```bash
# 备份原有 repo 文件
mkdir -p /etc/yum.repos.d/repo && cp /etc/yum.repos.d/*.repo /etc/yum.repos.d/repo/

# 写入清华 CentOS Stream 9 源（注意 'EOF' 要加引号，否则 $releasever、$basearch 会被 shell 展开成空字符串）
cat > /etc/yum.repos.d/rocky.repo << 'EOF'
[baseos]
name=CentOS Stream $releasever - BaseOS
baseurl=https://mirrors4.tuna.tsinghua.edu.cn/centos-stream/$releasever-stream/BaseOS/$basearch/os
# metalink=https://mirrors.centos.org/metalink?repo=centos-baseos-$stream&arch=$basearch&protocol=https,http
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-centosofficial
gpgcheck=1
repo_gpgcheck=0
metadata_expire=6h
countme=1
enabled=1

[baseos-debuginfo]
name=CentOS Stream $releasever - BaseOS - Debug
baseurl=https://mirrors4.tuna.tsinghua.edu.cn/centos-stream/$releasever-stream/BaseOS/$basearch/debug/tree/
# metalink=https://mirrors.centos.org/metalink?repo=centos-baseos-debug-$stream&arch=$basearch&protocol=https,http
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-centosofficial
gpgcheck=1
repo_gpgcheck=0
metadata_expire=6h
enabled=0

[baseos-source]
name=CentOS Stream $releasever - BaseOS - Source
baseurl=https://mirrors4.tuna.tsinghua.edu.cn/centos-stream/$releasever-stream/BaseOS/source/tree/
# metalink=https://mirrors.centos.org/metalink?repo=centos-baseos-source-$stream&arch=source&protocol=https,http
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-centosofficial
gpgcheck=1
repo_gpgcheck=0
metadata_expire=6h
enabled=0

[appstream]
name=CentOS Stream $releasever - AppStream
baseurl=https://mirrors4.tuna.tsinghua.edu.cn/centos-stream/$releasever-stream/AppStream/$basearch/os
# metalink=https://mirrors.centos.org/metalink?repo=centos-appstream-$stream&arch=$basearch&protocol=https,http
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-centosofficial
gpgcheck=1
repo_gpgcheck=0
metadata_expire=6h
countme=1
enabled=1

[appstream-debuginfo]
name=CentOS Stream $releasever - AppStream - Debug
baseurl=https://mirrors4.tuna.tsinghua.edu.cn/centos-stream/$releasever-stream/AppStream/$basearch/debug/tree/
# metalink=https://mirrors.centos.org/metalink?repo=centos-appstream-debug-$stream&arch=$basearch&protocol=https,http
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-centosofficial
gpgcheck=1
repo_gpgcheck=0
metadata_expire=6h
enabled=0

[appstream-source]
name=CentOS Stream $releasever - AppStream - Source
baseurl=https://mirrors4.tuna.tsinghua.edu.cn/centos-stream/$releasever-stream/AppStream/source/tree/
# metalink=https://mirrors.centos.org/metalink?repo=centos-appstream-source-$stream&arch=source&protocol=https,http
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-centosofficial
gpgcheck=1
repo_gpgcheck=0
metadata_expire=6h
enabled=0

[crb]
name=CentOS Stream $releasever - CRB
baseurl=https://mirrors4.tuna.tsinghua.edu.cn/centos-stream/$releasever-stream/CRB/$basearch/os
# metalink=https://mirrors.centos.org/metalink?repo=centos-crb-$stream&arch=$basearch&protocol=https,http
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-centosofficial
gpgcheck=1
repo_gpgcheck=0
metadata_expire=6h
countme=1
enabled=1

[crb-debuginfo]
name=CentOS Stream $releasever - CRB - Debug
baseurl=https://mirrors4.tuna.tsinghua.edu.cn/centos-stream/$releasever-stream/CRB/$basearch/debug/tree/
# metalink=https://mirrors.centos.org/metalink?repo=centos-crb-debug-$stream&arch=$basearch&protocol=https,http
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-centosofficial
gpgcheck=1
repo_gpgcheck=0
metadata_expire=6h
enabled=0

[crb-source]
name=CentOS Stream $releasever - CRB - Source
baseurl=https://mirrors4.tuna.tsinghua.edu.cn/centos-stream/$releasever-stream/CRB/source/tree/
# metalink=https://mirrors.centos.org/metalink?repo=centos-crb-source-$stream&arch=source&protocol=https,http
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-centosofficial
gpgcheck=1
repo_gpgcheck=0
metadata_expire=6h
enabled=0

[highavailability]
name=CentOS Stream $releasever - HighAvailability
baseurl=https://mirrors4.tuna.tsinghua.edu.cn/centos-stream/$releasever-stream/HighAvailability/$basearch/os
# metalink=https://mirrors.centos.org/metalink?repo=centos-highavailability-$stream&arch=$basearch&protocol=https,http
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-centosofficial
gpgcheck=1
repo_gpgcheck=0
metadata_expire=6h
countme=1
enabled=0

[highavailability-debuginfo]
name=CentOS Stream $releasever - HighAvailability - Debug
baseurl=https://mirrors4.tuna.tsinghua.edu.cn/centos-stream/$releasever-stream/HighAvailability/$basearch/debug/tree/
# metalink=https://mirrors.centos.org/metalink?repo=centos-highavailability-debug-$stream&arch=$basearch&protocol=https,http
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-centosofficial
gpgcheck=1
repo_gpgcheck=0
metadata_expire=6h
enabled=0

[highavailability-source]
name=CentOS Stream $releasever - HighAvailability - Source
baseurl=https://mirrors4.tuna.tsinghua.edu.cn/centos-stream/$releasever-stream/HighAvailability/source/tree/
# metalink=https://mirrors.centos.org/metalink?repo=centos-highavailability-source-$stream&arch=source&protocol=https,http
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-centosofficial
gpgcheck=1
repo_gpgcheck=0
metadata_expire=6h
enabled=0

[nfv]
name=CentOS Stream $releasever - NFV
baseurl=https://mirrors4.tuna.tsinghua.edu.cn/centos-stream/$releasever-stream/NFV/$basearch/os
# metalink=https://mirrors.centos.org/metalink?repo=centos-nfv-$stream&arch=$basearch&protocol=https,http
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-centosofficial
gpgcheck=1
repo_gpgcheck=0
metadata_expire=6h
countme=1
enabled=0

[nfv-debuginfo]
name=CentOS Stream $releasever - NFV - Debug
baseurl=https://mirrors4.tuna.tsinghua.edu.cn/centos-stream/$releasever-stream/NFV/$basearch/debug/tree/
# metalink=https://mirrors.centos.org/metalink?repo=centos-nfv-debug-$stream&arch=$basearch&protocol=https,http
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-centosofficial
gpgcheck=1
repo_gpgcheck=0
metadata_expire=6h
enabled=0

[nfv-source]
name=CentOS Stream $releasever - NFV - Source
baseurl=https://mirrors4.tuna.tsinghua.edu.cn/centos-stream/$releasever-stream/NFV/source/tree/
# metalink=https://mirrors.centos.org/metalink?repo=centos-nfv-source-$stream&arch=source&protocol=https,http
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-centosofficial
gpgcheck=1
repo_gpgcheck=0
metadata_expire=6h
enabled=0

[rt]
name=CentOS Stream $releasever - RT
baseurl=https://mirrors4.tuna.tsinghua.edu.cn/centos-stream/$releasever-stream/RT/$basearch/os
# metalink=https://mirrors.centos.org/metalink?repo=centos-rt-$stream&arch=$basearch&protocol=https,http
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-centosofficial
gpgcheck=1
repo_gpgcheck=0
metadata_expire=6h
countme=1
enabled=0

[rt-debuginfo]
name=CentOS Stream $releasever - RT - Debug
baseurl=https://mirrors4.tuna.tsinghua.edu.cn/centos-stream/$releasever-stream/RT/$basearch/debug/tree/
# metalink=https://mirrors.centos.org/metalink?repo=centos-rt-debug-$stream&arch=$basearch&protocol=https,http
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-centosofficial
gpgcheck=1
repo_gpgcheck=0
metadata_expire=6h
enabled=0

[rt-source]
name=CentOS Stream $releasever - RT - Source
baseurl=https://mirrors4.tuna.tsinghua.edu.cn/centos-stream/$releasever-stream/RT/source/tree/
# metalink=https://mirrors.centos.org/metalink?repo=centos-rt-source-$stream&arch=source&protocol=https,http
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-centosofficial
gpgcheck=1
repo_gpgcheck=0
metadata_expire=6h
enabled=0

[resilientstorage]
name=CentOS Stream $releasever - ResilientStorage
baseurl=https://mirrors4.tuna.tsinghua.edu.cn/centos-stream/$releasever-stream/ResilientStorage/$basearch/os
# metalink=https://mirrors.centos.org/metalink?repo=centos-resilientstorage-$stream&arch=$basearch&protocol=https,http
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-centosofficial
gpgcheck=1
repo_gpgcheck=0
metadata_expire=6h
countme=1
enabled=0

[resilientstorage-debuginfo]
name=CentOS Stream $releasever - ResilientStorage - Debug
baseurl=https://mirrors4.tuna.tsinghua.edu.cn/centos-stream/$releasever-stream/ResilientStorage/$basearch/debug/tree/
# metalink=https://mirrors.centos.org/metalink?repo=centos-resilientstorage-debug-$stream&arch=$basearch&protocol=https,http
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-centosofficial
gpgcheck=1
repo_gpgcheck=0
metadata_expire=6h
enabled=0

[resilientstorage-source]
name=CentOS Stream $releasever - ResilientStorage - Source
baseurl=https://mirrors4.tuna.tsinghua.edu.cn/centos-stream/$releasever-stream/ResilientStorage/source/tree/
# metalink=https://mirrors.centos.org/metalink?repo=centos-resilientstorage-source-$stream&arch=source&protocol=https,http
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-centosofficial
gpgcheck=1
repo_gpgcheck=0
metadata_expire=6h
enabled=0

[extras-common]
name=CentOS Stream $releasever - Extras packages
baseurl=https://mirrors4.tuna.tsinghua.edu.cn/centos-stream/SIGs/$releasever-stream/extras/$basearch/extras-common
# metalink=https://mirrors.centos.org/metalink?repo=centos-extras-sig-extras-common-$stream&arch=$basearch&protocol=https,http
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-CentOS-SIG-Extras-SHA512
gpgcheck=1
repo_gpgcheck=0
metadata_expire=6h
countme=1
enabled=1

[extras-common-source]
name=CentOS Stream $releasever - Extras packages - Source
baseurl=https://mirrors4.tuna.tsinghua.edu.cn/centos-stream/SIGs/$releasever-stream/extras/source/extras-common
# metalink=https://mirrors.centos.org/metalink?repo=centos-extras-sig-extras-common-source-$stream&arch=source&protocol=https,http
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-CentOS-SIG-Extras-SHA512
gpgcheck=1
repo_gpgcheck=0
metadata_expire=6h
enabled=0
EOF

dnf install --nogpgcheck -y centos-stream-repos && dnf install -y centos-release-openstack-dalmatian vim bash-completion && dnf makecache
```

> 注意：原笔记把上面的内容写进了 `/etc/yum.repos.d/repo/rocky.repo`（备份目录），dnf 不会读取子目录，等于没生效，这里改为直接覆盖 `/etc/yum.repos.d/rocky.repo`。安装 `centos-stream-repos` 后会多出一份 `centos.repo`，如果 `dnf` 提示 “Repository xxx is listed more than once”，删掉其中一份重复的即可。这种做法实际是让 Rocky 使用 CentOS Stream 9 的软件包，属于混用，生产环境请自行评估。

### 1.3 时间同步配置

**两个节点都执行：**

```bash
dnf install -y chrony && sed -i 's/^pool /#pool /g' /etc/chrony.conf
echo "server 192.168.1.10 iburst" >> /etc/chrony.conf
timedatectl set-timezone Asia/Shanghai && systemctl enable chronyd --now && systemctl restart chronyd
```

> 注意：`192.168.1.10` 是内网中的 NTP 服务器。如果你的环境没有它，可以让 controller 同步公网时间源并在 `/etc/chrony.conf` 加 `allow 192.168.1.0/24`，node1 改为 `server controller iburst`。

✅ 验证：在 node1 执行 `chronyc sources -v`，应看到 192.168.1.10 作为时间源，状态为 `^*`。

### 1.4 安装 OpenStack 基础包

**两个节点都执行：**

```bash
dnf install -y python3-openstackclient openstack-selinux python3 python3-chardet crudini
```

✅ 验证：执行 `openstack --version`，应显示版本信息。

## 二、Controller 节点：数据库和消息队列

### 2.1 安装和配置 MariaDB

```bash
dnf install -y mariadb mariadb-server python3-PyMySQL

cat > /etc/my.cnf.d/openstack.cnf << 'EOF'
[mysqld]
bind-address = 0.0.0.0
default-storage-engine = innodb
innodb_file_per_table = on
max_connections = 4096
collation-server = utf8_general_ci
character-set-server = utf8
EOF

systemctl enable mariadb --now && systemctl restart mariadb

# 安全配置（依次回答：当前密码为空、不切换 unix_socket、设置 root 密码、其余全部 Y）
mysql_secure_installation << EOF

n
Y
ChangeMe123
ChangeMe123
Y
Y
Y
Y
EOF
```

> 注意：Rocky 9 自带的 MariaDB 10.5 比旧版本多一个 “Switch to unix_socket authentication” 提问，所以应答里多了一行 `n`。如果你的版本提问顺序不同，请改为交互式执行 `mysql_secure_installation`。

✅ 验证：执行 `mysql -u root -pChangeMe123 -e "SHOW DATABASES;"`，应显示数据库列表。

### 2.2 安装和配置 RabbitMQ

```bash
dnf install -y rabbitmq-server

# 先启动服务，rabbitmqctl 才能连上
systemctl enable rabbitmq-server --now

# 添加 OpenStack 用户
rabbitmqctl add_user openstack ChangeMe123
rabbitmqctl set_user_tags openstack administrator   # 赋予管理员标签
rabbitmqctl set_permissions openstack ".*" ".*" ".*"

# 启用管理插件（可选）
rabbitmq-plugins enable rabbitmq_management
systemctl restart rabbitmq-server
```

✅ 验证：

1. 执行 `rabbitmqctl list_users`，应看到 openstack 用户。
2. 浏览器访问 `http://192.168.1.100:15672`，使用 `openstack` / `ChangeMe123` 登录管理界面（`guest` 账号默认只允许从 localhost 登录）。

### 2.3 安装 Memcached

```bash
dnf install -y memcached python3-memcached
sed -i 's/OPTIONS=.*/OPTIONS="-l 127.0.0.1,::1,controller"/' /etc/sysconfig/memcached
systemctl enable memcached.service --now && systemctl restart memcached.service
```

✅ 验证：执行 `systemctl status memcached.service`，状态应为 `active (running)`。

### 2.4 安装 etcd

```bash
dnf install -y etcd

cp /etc/etcd/etcd.conf /etc/etcd/etcd.conf.bak
cat > /etc/etcd/etcd.conf << 'EOF'
#[Member]
ETCD_DATA_DIR="/var/lib/etcd/default.etcd"
ETCD_LISTEN_PEER_URLS="http://192.168.1.100:2380"
ETCD_LISTEN_CLIENT_URLS="http://192.168.1.100:2379"
ETCD_NAME="controller"
#[Clustering]
ETCD_INITIAL_ADVERTISE_PEER_URLS="http://192.168.1.100:2380"
ETCD_ADVERTISE_CLIENT_URLS="http://192.168.1.100:2379"
ETCD_INITIAL_CLUSTER="controller=http://192.168.1.100:2380"
ETCD_INITIAL_CLUSTER_TOKEN="etcd-cluster-01"
ETCD_INITIAL_CLUSTER_STATE="new"
EOF

systemctl enable etcd --now && systemctl restart etcd
```

## 三、Controller 节点：身份服务（Keystone）

### 3.1 创建数据库

```bash
mysql -u root -pChangeMe123 << EOF
CREATE DATABASE keystone;
GRANT ALL PRIVILEGES ON keystone.* TO 'keystone'@'localhost' IDENTIFIED BY 'ChangeMe123';
GRANT ALL PRIVILEGES ON keystone.* TO 'keystone'@'%' IDENTIFIED BY 'ChangeMe123';
FLUSH PRIVILEGES;
EOF
```

### 3.2 安装和配置 Keystone

```bash
dnf install -y openstack-keystone httpd python3-mod_wsgi crudini

cp /etc/keystone/keystone.conf /etc/keystone/keystone.conf.bak

# crudini 语法：--set 文件 段名 键 值（段名是 DEFAULT，键和值之间不要写 =）
crudini --set /etc/keystone/keystone.conf DEFAULT transport_url rabbit://openstack:ChangeMe123@controller:5672
crudini --set /etc/keystone/keystone.conf database connection mysql+pymysql://keystone:ChangeMe123@controller/keystone
crudini --set /etc/keystone/keystone.conf token provider fernet

# 初始化数据库
su -s /bin/sh -c "keystone-manage db_sync" keystone

# 初始化 Fernet 密钥
keystone-manage fernet_setup --keystone-user keystone --keystone-group keystone
keystone-manage credential_setup --keystone-user keystone --keystone-group keystone
ls /etc/keystone/fernet-keys/ /etc/keystone/credential-keys/

# 引导身份服务
keystone-manage bootstrap --bootstrap-password ChangeMe123 \
  --bootstrap-admin-url http://controller:5000/v3/ \
  --bootstrap-internal-url http://controller:5000/v3/ \
  --bootstrap-public-url http://controller:5000/v3/ \
  --bootstrap-region-id RegionOne

# 配置 Apache
sed -i '/^ServerRoot/a\ServerName controller:80' /etc/httpd/conf/httpd.conf
ln -s /usr/share/keystone/wsgi-keystone.conf /etc/httpd/conf.d/

systemctl enable httpd.service --now && systemctl restart httpd.service
```

### 3.3 创建管理员环境变量文件

```bash
cat > ~/admin-openrc << EOF
export OS_USERNAME=admin
export OS_PASSWORD=ChangeMe123
export OS_PROJECT_NAME=admin
export OS_USER_DOMAIN_NAME=Default
export OS_PROJECT_DOMAIN_NAME=Default
export OS_AUTH_URL=http://controller:5000/v3
export OS_IDENTITY_API_VERSION=3
export PYTHONWARNINGS="ignore"
EOF
```

✅ 验证：

```bash
source ~/admin-openrc
openstack token issue
```

应成功返回令牌信息，包含有效期和用户 ID。

### 3.4 创建服务项目和用户

```bash
source ~/admin-openrc

# 示例域（可选）
openstack domain create --description "An Example Domain" example
# 创建 service 项目
openstack project create --domain default --description "Service Project" service
# 创建 demo 项目和用户
openstack project create --domain default --description "Demo Project" demo
openstack user create --domain default --password ChangeMe123 demo
openstack role create user
openstack role add --project demo --user demo user
```

## 四、Controller 节点：镜像服务（Glance）

### 4.1 创建数据库

```bash
mysql -u root -pChangeMe123 << EOF
CREATE DATABASE glance;
GRANT ALL PRIVILEGES ON glance.* TO 'glance'@'localhost' IDENTIFIED BY 'ChangeMe123';
GRANT ALL PRIVILEGES ON glance.* TO 'glance'@'%' IDENTIFIED BY 'ChangeMe123';
FLUSH PRIVILEGES;
EOF
```

### 4.2 创建 Glance 用户和服务

```bash
source ~/admin-openrc

openstack user create --domain default --password ChangeMe123 glance
openstack role add --project service --user glance admin
openstack service create --name glance --description "OpenStack Image" image
openstack endpoint create --region RegionOne image public http://controller:9292
openstack endpoint create --region RegionOne image internal http://controller:9292
openstack endpoint create --region RegionOne image admin http://controller:9292
```

### 4.3 安装和配置 Glance

原笔记的 `glance-api.conf` / `glance-scrubber.conf` 混入了大量已废弃或无效的选项（`rpc_backend`、`verbose`、`registry_host`、`rabbit_host` 等），这里精简为能正常工作的核心配置，存储后端仍沿用文件存储。

```bash
dnf install -y openstack-glance

cat > /etc/glance/glance-api.conf << 'EOF'
[DEFAULT]
bind_host = 0.0.0.0
bind_port = 9292
transport_url = rabbit://openstack:ChangeMe123@controller:5672/
enable_proxy_headers_parsing = true
show_image_direct_url = true
log_dir = /var/log/glance

[database]
connection = mysql+pymysql://glance:ChangeMe123@controller/glance?charset=utf8

[keystone_authtoken]
www_authenticate_uri = http://controller:5000
auth_url = http://controller:5000
memcached_servers = controller:11211
auth_type = password
project_domain_name = Default
user_domain_name = Default
project_name = service
username = glance
password = ChangeMe123

[paste_deploy]
flavor = keystone

[glance_store]
stores = file,http
default_store = file
filesystem_store_datadir = /var/lib/glance/images/

[oslo_messaging_notifications]
driver = messagingv2

[oslo_concurrency]
lock_path = /var/lib/glance/lock
EOF

cat > /etc/glance/glance-scrubber.conf << 'EOF'
[DEFAULT]
log_dir = /var/log/glance
daemon = true
wakeup_time = 300

[database]
connection = mysql+pymysql://glance:ChangeMe123@controller/glance?charset=utf8

[glance_store]
stores = file,http
default_store = file
filesystem_store_datadir = /var/lib/glance/images/

[oslo_concurrency]
lock_path = /var/lib/glance/lock
EOF

# 同步数据库
su -s /bin/sh -c "glance-manage db_sync" glance

systemctl enable openstack-glance-api openstack-glance-scrubber --now
systemctl restart openstack-glance-api openstack-glance-scrubber

# 下载并上传 Cirros 测试镜像
source ~/admin-openrc
wget -q -P /opt http://download.cirros-cloud.net/0.5.2/cirros-0.5.2-x86_64-disk.img
openstack image create "cirros" \
  --file /opt/cirros-0.5.2-x86_64-disk.img \
  --disk-format qcow2 \
  --container-format bare \
  --public
```

> 注意：原笔记在 `stores` 里还启用了 `cinder` 后端，这需要先装好 Cinder 并额外安装 `python3-cinderclient`、`python3-os-brick`，否则 glance-api 可能启动报错。建议先用 `file`，Cinder 部署完成后再按需加回。

✅ 验证：执行 `openstack image list`，应看到 cirros 镜像，状态为 `active`。

## 五、Controller 节点：配置服务（Placement）

### 5.1 创建数据库

```bash
mysql -u root -pChangeMe123 << EOF
CREATE DATABASE placement;
GRANT ALL PRIVILEGES ON placement.* TO 'placement'@'localhost' IDENTIFIED BY 'ChangeMe123';
GRANT ALL PRIVILEGES ON placement.* TO 'placement'@'%' IDENTIFIED BY 'ChangeMe123';
FLUSH PRIVILEGES;
EOF
```

### 5.2 创建 Placement 用户和服务

```bash
source ~/admin-openrc

openstack user create --domain default --password ChangeMe123 placement
openstack role add --project service --user placement admin
openstack service create --name placement --description "Placement API" placement
openstack endpoint create --region RegionOne placement public http://controller:8778
openstack endpoint create --region RegionOne placement internal http://controller:8778
openstack endpoint create --region RegionOne placement admin http://controller:8778
```

### 5.3 安装和配置 Placement

```bash
dnf install -y openstack-placement-api

cat > /etc/placement/placement.conf << 'EOF'
[DEFAULT]
debug = false
log_dir = /var/log/placement

[api]
auth_strategy = keystone

[keystone_authtoken]
www_authenticate_uri = http://controller:5000
auth_url = http://controller:5000/v3
memcached_servers = controller:11211
auth_type = password
project_domain_name = Default
user_domain_name = Default
project_name = service
username = placement
password = ChangeMe123

[placement_database]
connection = mysql+pymysql://placement:ChangeMe123@controller/placement
EOF

# 同步数据库
su -s /bin/sh -c "placement-manage db sync" placement

# RDO 打包的 Placement 默认没有放行 /usr/bin，访问会 403，需要授权
cat >> /etc/httpd/conf.d/00-placement-api.conf << 'EOF'
<Directory /usr/bin>
  Require all granted
</Directory>
EOF

systemctl restart httpd
```

✅ 验证：执行 `placement-status upgrade check`，所有检查项应为 `Success`。

## 六、计算服务（Nova）

### 6.1 Controller 节点：安装控制组件

#### 6.1.1 创建数据库

```bash
mysql -u root -pChangeMe123 << EOF
CREATE DATABASE IF NOT EXISTS nova_api;
CREATE DATABASE IF NOT EXISTS nova;
CREATE DATABASE IF NOT EXISTS nova_cell0;
GRANT ALL PRIVILEGES ON nova_api.* TO 'nova'@'localhost' IDENTIFIED BY 'ChangeMe123';
GRANT ALL PRIVILEGES ON nova_api.* TO 'nova'@'%' IDENTIFIED BY 'ChangeMe123';
GRANT ALL PRIVILEGES ON nova.* TO 'nova'@'localhost' IDENTIFIED BY 'ChangeMe123';
GRANT ALL PRIVILEGES ON nova.* TO 'nova'@'%' IDENTIFIED BY 'ChangeMe123';
GRANT ALL PRIVILEGES ON nova_cell0.* TO 'nova'@'localhost' IDENTIFIED BY 'ChangeMe123';
GRANT ALL PRIVILEGES ON nova_cell0.* TO 'nova'@'%' IDENTIFIED BY 'ChangeMe123';
FLUSH PRIVILEGES;
EOF
```

#### 6.1.2 创建 Nova 用户和服务

```bash
source ~/admin-openrc

openstack user create --domain default --password ChangeMe123 nova
openstack role add --project service --user nova admin
openstack service create --name nova --description "OpenStack Compute" compute
openstack endpoint create --region RegionOne compute public http://controller:8774/v2.1
openstack endpoint create --region RegionOne compute internal http://controller:8774/v2.1
openstack endpoint create --region RegionOne compute admin http://controller:8774/v2.1
```

#### 6.1.3 安装和配置 Nova 控制组件

```bash
dnf install -y openstack-nova-api openstack-nova-conductor openstack-nova-novncproxy openstack-nova-scheduler

cat > /etc/nova/nova.conf << 'EOF'
[DEFAULT]
enabled_apis = osapi_compute,metadata
transport_url = rabbit://openstack:ChangeMe123@controller:5672/
my_ip = 192.168.1.100

[api]
auth_strategy = keystone

[api_database]
connection = mysql+pymysql://nova:ChangeMe123@controller/nova_api

[database]
connection = mysql+pymysql://nova:ChangeMe123@controller/nova

[glance]
api_servers = http://controller:9292

[keystone_authtoken]
www_authenticate_uri = http://controller:5000
auth_url = http://controller:5000
memcached_servers = controller:11211
auth_type = password
project_domain_name = Default
user_domain_name = Default
project_name = service
username = nova
password = ChangeMe123

[service_user]
send_service_user_token = true
auth_url = http://controller:5000/v3
auth_type = password
project_domain_name = Default
project_name = service
user_domain_name = Default
username = nova
password = ChangeMe123

[neutron]
auth_url = http://controller:5000
auth_type = password
project_domain_name = Default
user_domain_name = Default
project_name = service
username = neutron
password = ChangeMe123
region_name = RegionOne

[oslo_concurrency]
lock_path = /var/lib/nova/tmp

[placement]
region_name = RegionOne
project_domain_name = Default
project_name = service
auth_type = password
user_domain_name = Default
auth_url = http://controller:5000/v3
username = placement
password = ChangeMe123

[vnc]
enabled = true
server_listen = $my_ip
server_proxyclient_address = $my_ip
novncproxy_base_url = http://192.168.1.100:6080/vnc_auto.html
EOF

# 同步数据库
su -s /bin/sh -c "nova-manage api_db sync" nova
su -s /bin/sh -c "nova-manage cell_v2 map_cell0" nova
su -s /bin/sh -c "nova-manage cell_v2 create_cell --name=cell1 --verbose" nova
su -s /bin/sh -c "nova-manage db sync" nova
su -s /bin/sh -c "nova-manage cell_v2 list_cells" nova

systemctl enable --now openstack-nova-api.service openstack-nova-scheduler.service openstack-nova-conductor.service openstack-nova-novncproxy.service
systemctl restart openstack-nova-api.service openstack-nova-scheduler.service openstack-nova-conductor.service openstack-nova-novncproxy.service
```

> 注意：原笔记中的 `use_neutron`、`firewall_driver`、`auth_uri`、`[oslo_messaging_rabbit] rabbit_host` 等都是旧版本选项，2024.2 已移除，这里删掉；`[service_user]` 的 `auth_url` 原来写成了 DevStack 风格的 `/identity`，已改为 `http://controller:5000/v3`。

### 6.2 Node1 节点：安装计算组件

#### 6.2.1 安装 Nova 计算组件

```bash
dnf install -y openstack-nova-compute

cat > /etc/nova/nova.conf << EOF
[DEFAULT]
transport_url = rabbit://openstack:ChangeMe123@controller:5672/
my_ip = 192.168.1.101
log_dir = /var/log/nova
state_path = /var/lib/nova

[api]
auth_strategy = keystone

[glance]
api_servers = http://controller:9292

[keystone_authtoken]
www_authenticate_uri = http://controller:5000/
auth_url = http://controller:5000/
memcached_servers = controller:11211
auth_type = password
project_domain_name = Default
user_domain_name = Default
project_name = service
username = nova
password = ChangeMe123

[service_user]
send_service_user_token = true
auth_url = http://controller:5000/v3
auth_type = password
project_domain_name = Default
project_name = service
user_domain_name = Default
username = nova
password = ChangeMe123

[neutron]
auth_url = http://controller:5000
auth_type = password
project_domain_name = Default
user_domain_name = Default
project_name = service
username = neutron
password = ChangeMe123
region_name = RegionOne

[libvirt]
virt_type = qemu

[oslo_concurrency]
lock_path = /var/lib/nova/tmp

[placement]
region_name = RegionOne
project_domain_name = Default
project_name = service
auth_type = password
user_domain_name = Default
auth_url = http://controller:5000/v3
username = placement
password = ChangeMe123

[vnc]
enabled = true
server_listen = 0.0.0.0
server_proxyclient_address = \$my_ip
novncproxy_base_url = http://192.168.1.100:6080/vnc_auto.html
EOF

# 检查虚拟化支持：返回 0 说明不支持硬件虚拟化，保持 virt_type = qemu；
# 返回大于 0 时可改为 kvm 以获得更好性能
if [ "$(grep -Ec '(vmx|svm)' /proc/cpuinfo)" -eq 0 ]; then
    echo "Using QEMU virtualization"
else
    echo "CPU 支持硬件虚拟化，可执行：crudini --set /etc/nova/nova.conf libvirt virt_type kvm"
fi

systemctl enable libvirtd.service openstack-nova-compute.service --now
systemctl restart openstack-nova-compute.service
```

> 注意：原笔记 node1 的 `my_ip` 写成了 controller 的 192.168.1.100，已改为 192.168.1.101；同时补上了计算节点需要的 `[service_user]` 和 `[neutron]` 认证段。另外，node1 上还需要部署 Neutron 二层代理（与 controller 选用的 Linux Bridge 或 OVS 一致），否则虚拟机无法获得网络，原笔记缺少这一步，可参照第七章 controller 的代理配置，把 `local_ip` 换成 192.168.1.101。

#### 6.2.2 在 Controller 上发现计算节点

```bash
# 在 controller 节点执行
source ~/admin-openrc
su -s /bin/sh -c "nova-manage cell_v2 discover_hosts --verbose" nova
```

✅ 验证：在 controller 执行 `openstack compute service list`，应看到 node1 上的 nova-compute 状态为 `up`。

## 七、网络服务（Neutron）- 使用 Provider Networks

### 7.1 Controller 节点：安装服务器组件

#### 7.1.1 创建数据库

```bash
mysql -u root -pChangeMe123 << EOF
CREATE DATABASE neutron;
GRANT ALL PRIVILEGES ON neutron.* TO 'neutron'@'localhost' IDENTIFIED BY 'ChangeMe123';
GRANT ALL PRIVILEGES ON neutron.* TO 'neutron'@'%' IDENTIFIED BY 'ChangeMe123';
FLUSH PRIVILEGES;
EOF
```

#### 7.1.2 创建 Neutron 用户和服务

```bash
source ~/admin-openrc

openstack user create --domain default --password ChangeMe123 neutron
openstack role add --project service --user neutron admin
openstack service create --name neutron --description "OpenStack Networking" network
openstack endpoint create --region RegionOne network public http://controller:9696
openstack endpoint create --region RegionOne network internal http://controller:9696
openstack endpoint create --region RegionOne network admin http://controller:9696
```

#### 7.1.3 启用内核模块

```bash
echo br_netfilter > /etc/modules-load.d/openstack.conf
modprobe br_netfilter
cat > /etc/sysctl.d/openstack.conf << EOF
net.bridge.bridge-nf-call-ip6tables = 1
net.bridge.bridge-nf-call-iptables = 1
EOF
sysctl --system
```

#### 7.1.4 安装和配置 Neutron 服务器组件

```bash
dnf install -y openstack-neutron openstack-neutron-ml2 openstack-neutron-linuxbridge ebtables

cat > /etc/neutron/neutron.conf << EOF
[DEFAULT]
core_plugin = ml2
service_plugins = router
transport_url = rabbit://openstack:ChangeMe123@controller:5672/
auth_strategy = keystone
notify_nova_on_port_status_changes = true
notify_nova_on_port_data_changes = true
allow_overlapping_ips = true

[database]
connection = mysql+pymysql://neutron:ChangeMe123@controller/neutron

[keystone_authtoken]
www_authenticate_uri = http://controller:5000
auth_url = http://controller:5000
memcached_servers = controller:11211
auth_type = password
project_domain_name = Default
user_domain_name = Default
project_name = service
username = neutron
password = ChangeMe123

[nova]
auth_url = http://controller:5000
auth_type = password
project_domain_name = Default
user_domain_name = Default
region_name = RegionOne
project_name = service
username = nova
password = ChangeMe123

[experimental]
linuxbridge = true

[oslo_concurrency]
lock_path = /var/lib/neutron/tmp
EOF

# 配置 ML2 插件
cat > /etc/neutron/plugins/ml2/ml2_conf.ini << EOF
[ml2]
type_drivers = flat,vlan
tenant_network_types =
mechanism_drivers = linuxbridge
extension_drivers = port_security

[ml2_type_flat]
flat_networks = provider

[ml2_type_vxlan]
vni_ranges = 1:1000

[securitygroup]
enable_ipset = true
EOF

# 配置 Linux Bridge 代理（enp7s0 为 provider 网络使用的网卡）
cat > /etc/neutron/plugins/ml2/linuxbridge_agent.ini << EOF
[linux_bridge]
physical_interface_mappings = provider:enp7s0

[securitygroup]
firewall_driver = neutron.agent.linux.iptables_firewall.IptablesFirewallDriver
enable_security_group = true

[vxlan]
enable_vxlan = false
local_ip = 192.168.1.100
l2_population = true
EOF

# 配置 L3 代理
cat > /etc/neutron/l3_agent.ini << EOF
[DEFAULT]
interface_driver = linuxbridge
EOF

# 配置 DHCP 代理
cat > /etc/neutron/dhcp_agent.ini << EOF
[DEFAULT]
interface_driver = linuxbridge
dhcp_driver = neutron.agent.linux.dhcp.Dnsmasq
enable_isolated_metadata = true
EOF

# 配置元数据代理
cat > /etc/neutron/metadata_agent.ini << EOF
[DEFAULT]
nova_metadata_host = controller
metadata_proxy_shared_secret = ChangeMe123
EOF

# 配置 Nova 使用 Neutron（[neutron] 认证信息已在 6.1.3 写好，这里只补元数据代理相关项）
crudini --set /etc/nova/nova.conf neutron service_metadata_proxy true
crudini --set /etc/nova/nova.conf neutron metadata_proxy_shared_secret ChangeMe123

# 同步数据库
ln -s /etc/neutron/plugins/ml2/ml2_conf.ini /etc/neutron/plugin.ini
su -s /bin/sh -c "neutron-db-manage --config-file /etc/neutron/neutron.conf --config-file /etc/neutron/plugins/ml2/ml2_conf.ini upgrade head" neutron

# 启动服务
systemctl restart openstack-nova-api.service
systemctl enable --now neutron-server.service neutron-linuxbridge-agent.service neutron-dhcp-agent.service neutron-metadata-agent.service neutron-l3-agent.service
systemctl restart neutron-server.service neutron-linuxbridge-agent.service neutron-dhcp-agent.service neutron-metadata-agent.service neutron-l3-agent.service
```

> 注意：在 2024.2 中 Linux Bridge 机制驱动属于实验特性，必须保留 `[experimental] linuxbridge = true`，否则 neutron-server 拒绝启动。原笔记 `neutron.conf` 里的重复 `[nova]` 段、`rpc_backend`、`auth_uri` 以及 `l3_agent.ini` 的 `external_network_bridge` 均已删除。

### 7.2 Controller 节点：安装 OpenvSwitch 网络机制

> 注意：Linux Bridge（7.1）和 OpenvSwitch（7.2）是二选一的二层方案，原笔记两者混用（ML2 仍是 `linuxbridge`，重启的也还是 linuxbridge 代理）。如果改用 OVS，请按下面的步骤停用 linuxbridge 代理并同步修改 ML2 配置。

#### 7.2.1 安装 OpenvSwitch 相关软件包

```bash
dnf install -y openstack-neutron-openvswitch

# 停用 Linux Bridge 代理，启动 OVS
systemctl disable --now neutron-linuxbridge-agent.service
systemctl enable --now openvswitch.service

# 创建虚拟网桥（enp7s0 必须是没有配置 IP 的独立网卡，否则会断开管理网络）
ovs-vsctl add-br br-int
ovs-vsctl add-br br-ex && ovs-vsctl add-port br-ex enp7s0
```

#### 7.2.2 配置 OpenvSwitch

```bash
# ML2 改为 openvswitch 机制驱动，并启用 vxlan 租户网络（与下面代理的 tunnel_types 保持一致）
crudini --set /etc/neutron/plugins/ml2/ml2_conf.ini ml2 type_drivers flat,vlan,vxlan
crudini --set /etc/neutron/plugins/ml2/ml2_conf.ini ml2 tenant_network_types vxlan
crudini --set /etc/neutron/plugins/ml2/ml2_conf.ini ml2 mechanism_drivers openvswitch,l2population

# bridge_mappings 映射到网桥 br-ex，而不是网卡名
cat > /etc/neutron/plugins/ml2/openvswitch_agent.ini << EOF
[ovs]
bridge_mappings = provider:br-ex
local_ip = 192.168.1.100

[agent]
tunnel_types = vxlan
l2_population = true

[securitygroup]
enable_security_group = true
firewall_driver = openvswitch
EOF

cat > /etc/neutron/l3_agent.ini << EOF
[DEFAULT]
interface_driver = openvswitch
EOF

cat > /etc/neutron/dhcp_agent.ini << EOF
[DEFAULT]
interface_driver = openvswitch
dhcp_driver = neutron.agent.linux.dhcp.Dnsmasq
enable_isolated_metadata = true
EOF

# 初始化数据库
su -s /bin/sh -c "neutron-db-manage --config-file /etc/neutron/neutron.conf --config-file /etc/neutron/plugins/ml2/ml2_conf.ini upgrade head" neutron

# 重启服务
systemctl restart openstack-nova-api.service
systemctl enable --now neutron-openvswitch-agent.service
systemctl restart neutron-server.service neutron-openvswitch-agent.service neutron-dhcp-agent.service neutron-metadata-agent.service neutron-l3-agent.service
```

✅ 验证：执行 `openstack network agent list`，所有代理的 `State` 应为 `UP`、`Alive` 为 `:-)`。

### 7.3 Controller 节点：安装 Cinder 服务

#### 7.3.1 配置 Cinder 端点服务

```bash
# 准备 Cinder 数据库
mysql -u root -pChangeMe123 << EOF
CREATE DATABASE cinder;
GRANT ALL PRIVILEGES ON cinder.* TO 'cinder'@'localhost' IDENTIFIED BY 'ChangeMe123';
GRANT ALL PRIVILEGES ON cinder.* TO 'cinder'@'%' IDENTIFIED BY 'ChangeMe123';
FLUSH PRIVILEGES;
EOF

# 创建 cinder 服务用户并分配角色
source ~/admin-openrc
openstack user create --domain default --password ChangeMe123 cinder
openstack role add --project service --user cinder admin
openstack service create --name cinderv3 --description "OpenStack Block Storage" volumev3
openstack endpoint create --region RegionOne volumev3 public http://controller:8776/v3/%\(project_id\)s
openstack endpoint create --region RegionOne volumev3 internal http://controller:8776/v3/%\(project_id\)s
openstack endpoint create --region RegionOne volumev3 admin http://controller:8776/v3/%\(project_id\)s
```

#### 7.3.2 安装配置 Cinder 组件

```bash
dnf install -y openstack-cinder

cat > /etc/cinder/cinder.conf << EOF
[DEFAULT]
transport_url = rabbit://openstack:ChangeMe123@controller
auth_strategy = keystone
my_ip = 192.168.1.100

[database]
connection = mysql+pymysql://cinder:ChangeMe123@controller/cinder

[keystone_authtoken]
www_authenticate_uri = http://controller:5000
auth_url = http://controller:5000
memcached_servers = controller:11211
auth_type = password
project_domain_name = default
user_domain_name = default
project_name = service
username = cinder
password = ChangeMe123

[oslo_concurrency]
lock_path = /var/lib/cinder/tmp
EOF

# 同步数据库
su -s /bin/sh -c "cinder-manage db sync" cinder

# 配置计算服务使用 Cinder
crudini --set /etc/nova/nova.conf cinder os_region_name RegionOne

systemctl restart openstack-nova-api.service
systemctl enable --now openstack-cinder-api.service openstack-cinder-scheduler.service
systemctl restart openstack-cinder-api.service openstack-cinder-scheduler.service
```

### 7.4 Controller 节点：安装配置 Cinder 存储节点

#### 7.4.1 准备 LVM

```bash
dnf install -y lvm2 device-mapper-persistent-data

# 确认数据盘（示例为 /dev/vdb）
lsblk
pvcreate /dev/vdb && vgcreate cinder-volumes /dev/vdb
```

编辑 `/etc/lvm/lvm.conf`，在 `devices { }` 段中限定 LVM 扫描范围：

```text
devices {
    filter = [ "a/vdb/", "r/.*/" ]
}
```

> 注意：Rocky 默认把系统盘也装在 LVM 上（如 `/dev/vda`），这种情况必须把系统盘也加入过滤器，例如 `filter = [ "a/vda/", "a/vdb/", "r/.*/" ]`，否则系统卷可能无法被识别。

#### 7.4.2 安装配置 Cinder 存储组件及备份服务

```bash
dnf install -y openstack-cinder targetcli

cat > /etc/cinder/cinder.conf << EOF
[DEFAULT]
auth_strategy = keystone
transport_url = rabbit://openstack:ChangeMe123@controller
my_ip = 192.168.1.100
enabled_backends = lvm
glance_api_servers = http://controller:9292
backup_driver = cinder.backup.drivers.posix.PosixBackupDriver
backup_posix_path = /var/lib/cinder/backup
backup_compression_algorithm = zlib
backup_enable_progress_timer = true

[database]
connection = mysql+pymysql://cinder:ChangeMe123@controller/cinder

[keystone_authtoken]
www_authenticate_uri = http://controller:5000
auth_url = http://controller:5000
memcached_servers = controller:11211
auth_type = password
project_domain_name = default
user_domain_name = default
project_name = service
username = cinder
password = ChangeMe123

[lvm]
volume_driver = cinder.volume.drivers.lvm.LVMVolumeDriver
volume_group = cinder-volumes
target_protocol = iscsi
target_helper = lioadm

[oslo_concurrency]
lock_path = /var/lib/cinder/tmp
EOF

# 创建备份目录并设置权限
mkdir -p /var/lib/cinder/backup
chown cinder:cinder /var/lib/cinder/backup
chmod 750 /var/lib/cinder/backup

# 同步数据库（以 cinder 用户执行）
su -s /bin/sh -c "cinder-manage db sync" cinder

systemctl enable --now iscsid target.service
systemctl enable --now openstack-cinder-api.service openstack-cinder-backup.service openstack-cinder-scheduler.service openstack-cinder-volume.service
systemctl restart openstack-cinder-api.service openstack-cinder-backup.service openstack-cinder-scheduler.service openstack-cinder-volume.service
```

✅ 验证：

```bash
source ~/admin-openrc
openstack volume service list
openstack volume create --size 1 test-volume-lxh
openstack volume backup create --name backupfile test-volume-lxh
ls /var/lib/cinder/backup/
```

`volume service list` 中 cinder-scheduler、cinder-volume、cinder-backup 应为 `up`，卷状态为 `available`，备份完成后 `/var/lib/cinder/backup/` 下出现备份文件。

### 7.5 安装配置 Horizon 服务

```bash
dnf install -y openstack-dashboard
```

编辑 `/etc/openstack-dashboard/local_settings`（RDO 中 `local_settings.py` 是指向它的软链接），修改或添加以下内容：

```python
OPENSTACK_HOST = "controller"
ALLOWED_HOSTS = ['*']  # 允许访问的主机，生产环境请收紧
SESSION_ENGINE = 'django.contrib.sessions.backends.cache'

CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.memcached.PyMemcacheCache',
        'LOCATION': 'controller:11211',
    }
}

OPENSTACK_KEYSTONE_URL = "http://%s:5000/v3" % OPENSTACK_HOST

WEBROOT = '/dashboard/'

OPENSTACK_KEYSTONE_MULTIDOMAIN_SUPPORT = True
OPENSTACK_KEYSTONE_DEFAULT_DOMAIN = "Default"
OPENSTACK_API_VERSIONS = {
    "identity": 3,
    "image": 2,
    "volume": 3,
}
OPENSTACK_KEYSTONE_DEFAULT_ROLE = "user"
TIME_ZONE = "Asia/Shanghai"
```

```bash
# 若 /etc/httpd/conf.d/openstack-dashboard.conf 中没有这一行则补上
grep -q 'WSGIApplicationGroup' /etc/httpd/conf.d/openstack-dashboard.conf || \
  sed -i '1i WSGIApplicationGroup %{GLOBAL}' /etc/httpd/conf.d/openstack-dashboard.conf

systemctl restart httpd.service memcached.service
```

> 注意：新版 Django 已移除 `MemcachedCache` 后端，需改用 `PyMemcacheCache`；Keystone 地址原来写成了 DevStack 风格的 `/identity/v3`，这里改为 `http://controller:5000/v3`。

✅ 验证：浏览器访问 `http://192.168.1.100/dashboard`，域填 `Default`，使用 `admin` / `ChangeMe123` 登录。

## 部署完成验证清单

1. [x] Keystone：`openstack token issue` 成功
2. [x] Glance：`openstack image list` 显示 cirros 镜像，状态 `active`
3. [x] Placement：`placement-status upgrade check` 全部通过
4. [x] Nova：`openstack compute service list` 所有服务 `up`
5. [x] Neutron：`openstack network agent list` 所有代理 `up`
6. [x] Cinder：`openstack volume service list` 所有服务 `up`，可创建卷和备份
7. [x] Horizon：浏览器访问 `http://192.168.1.100/dashboard` 可登录
8. [x] 虚拟机：可创建并分配浮动 IP，可 ping 通（需要 node1 也部署好 Neutron 代理）

## 故障排查

如果任何步骤失败，先用 `systemctl status <服务名>` 看服务状态，再查看对应日志并根据报错调整：

- Keystone / Placement / Horizon：`/var/log/keystone/`、`/var/log/placement/`、`/var/log/httpd/`
- Glance、Nova、Neutron、Cinder：`/var/log/glance/`、`/var/log/nova/`、`/var/log/neutron/`、`/var/log/cinder/`
- 消息队列和数据库：`/var/log/rabbitmq/`、`journalctl -u mariadb`

## 常见问题

1. **repo 里的 `$releasever` 变成了空**：写 repo 文件时 heredoc 用的是不带引号的 `EOF`，shell 会把 `$releasever`、`$basearch` 展开成空字符串，必须写成 `<< 'EOF'`。
2. **`rabbitmqctl add_user` 报连不上节点**：RabbitMQ 服务还没启动，要先 `systemctl enable rabbitmq-server --now` 再创建用户；管理界面也不要用 `guest` 远程登录。
3. **Placement API 返回 403**：RDO 打包的 Placement 没有放行 `/usr/bin`，需要在 `00-placement-api.conf` 里加 `<Directory /usr/bin> Require all granted </Directory>` 后重启 httpd。
4. **计算节点不支持硬件虚拟化**：`grep -Ec '(vmx|svm)' /proc/cpuinfo` 返回 0 时，`[libvirt] virt_type` 必须保持 `qemu`。
5. **Linux Bridge 与 OVS 混用**：两种机制二选一，ML2 的 `mechanism_drivers`、L3/DHCP 的 `interface_driver` 和实际运行的代理必须一致；OVS 的 `bridge_mappings` 要映射到网桥（`br-ex`），不是网卡名。
6. **LVM 过滤器导致系统卷消失**：`/etc/lvm/lvm.conf` 的 `filter` 只放行 `vdb` 时，系统盘如果也在 LVM 上会被拒绝扫描，记得把系统盘加进去。
