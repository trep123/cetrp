---
title: Debian 12 (bookworm) 部署 OpenStack Zed 双节点
date: 2026-10-10
tags: [OpenStack, 云计算, Debian, Debian 12, Zed, Linux Bridge]
description: 在两台 Debian 12 主机上用官方 APT 源手动部署 OpenStack Zed（Keystone、Glance、Placement、Nova、Neutron、Horizon），使用 Provider 网络完成虚拟机测试。
---

# Debian 12 (bookworm) 部署 OpenStack Zed 双节点

本文记录在两台 Debian 12 (bookworm) 主机上手动部署 OpenStack 的完整过程，OpenStack 版本为 bookworm 官方源自带的 Zed（具体小版本以实际安装的版本为准）。节点规划：`controller`（192.168.1.100，控制节点：MariaDB、RabbitMQ、Memcached、Keystone、Glance、Placement、Nova 控制组件、Neutron 服务端及各代理、Horizon）和 `node1`（192.168.1.101，计算节点：nova-compute、neutron-linuxbridge-agent）。两台机器的第二块网卡 `ens224` 接入 192.168.20.0/24 网段，作为 Provider（外部）网络，网络方案为 ML2 + Linux Bridge。

> **提示**：文中所有密码（`ChangeMe123`）都是示例，部署前请统一替换成你自己的强密码。

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

✅ 验证：在 controller 执行 `ping node1`，应收到 192.168.1.101 的回复；在 node1 执行 `ping controller`，应收到 192.168.1.100 的回复。

### 1.2 配置 APT 源

两个节点使用相同的清华镜像源：

```bash
cat > /etc/apt/sources.list << EOF
deb https://mirrors.tuna.tsinghua.edu.cn/debian/ bookworm main contrib non-free non-free-firmware
deb https://mirrors.tuna.tsinghua.edu.cn/debian/ bookworm-updates main contrib non-free non-free-firmware
deb https://mirrors.tuna.tsinghua.edu.cn/debian/ bookworm-backports main contrib non-free non-free-firmware
deb https://mirrors.tuna.tsinghua.edu.cn/debian-security bookworm-security main contrib non-free non-free-firmware
EOF
apt update
```

> 注意：我最初的笔记里写的是 `trixie`（Debian 13）的源。在 Debian 12 上直接套用 trixie 源会把系统混装成 Debian 13 的软件包，装到的 OpenStack 也会变成 trixie 自带的 2025.1 Epoxy，和本文不一致，所以这里统一改成 `bookworm`。bookworm 官方源自带的 OpenStack 是 Zed；如果想在 Debian 12 上用更新的版本，可以改用 osbpo.debian.net 的 `bookworm-<版本>-backports` 源。实际装到的版本可以用 `apt policy keystone` 确认。

### 1.3 时间同步配置

两个节点都同步到内网 NTP 服务器 192.168.1.10：

```bash
apt install -y chrony
sed -i 's/^pool /#pool /g' /etc/chrony/chrony.conf
echo "server 192.168.1.10 iburst" >> /etc/chrony/chrony.conf
timedatectl set-timezone Asia/Shanghai
systemctl restart chrony && systemctl enable chrony
```

✅ 验证：执行 `chronyc sources -v`，应看到 192.168.1.10 作为时间源，状态为 `^*`。

> 注意：如果没有内网 NTP 服务器，把 `192.168.1.10` 换成 `ntp.aliyun.com` 即可。

### 1.4 安装 OpenStack 客户端

**两个节点都执行：**

```bash
apt install -y python3-openstackclient
```

✅ 验证：执行 `openstack --version`，应显示版本信息。

## 二、Controller 节点：数据库和消息队列

### 2.1 安装和配置 MariaDB

```bash
apt install -y mariadb-server python3-pymysql

# 调整最大连接数，并监听所有地址（各服务通过 controller 主机名连接数据库）
sed -i 's/^#max_connections        = 100$/max_connections        = 700/' /etc/mysql/mariadb.conf.d/50-server.cnf
sed -i 's/^bind-address.*/bind-address            = 0.0.0.0/' /etc/mysql/mariadb.conf.d/50-server.cnf

systemctl restart mariadb && systemctl enable mariadb

# 安全配置（依次：当前密码为空、不切换 unix_socket、修改 root 密码、新密码×2、删除匿名用户、禁止 root 远程登录、删除 test 库、刷新权限）
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

> 注意：`mysql_secure_installation` 的提问顺序随 MariaDB 版本不同而变化，上面的应答顺序对应 bookworm 自带的 MariaDB 10.11。如果不放心，可以直接交互式执行。

✅ 验证：执行 `mysql -u root -pChangeMe123 -e "SHOW DATABASES;"`，应显示数据库列表。

### 2.2 安装和配置 RabbitMQ

```bash
apt install -y rabbitmq-server

# 添加 openstack 用户并赋予管理员标签
rabbitmqctl add_user openstack ChangeMe123
rabbitmqctl set_user_tags openstack administrator
rabbitmqctl set_permissions openstack ".*" ".*" ".*"

# 启用管理插件（可选）
rabbitmq-plugins enable rabbitmq_management
systemctl restart rabbitmq-server && systemctl enable rabbitmq-server
```

✅ 验证：

1. 执行 `rabbitmqctl list_users`，应看到 openstack 用户；
2. 浏览器访问 `http://192.168.1.100:15672`，用 `openstack / ChangeMe123` 登录管理界面（`guest` 账号默认只允许从本机登录）。

### 2.3 安装 Memcached

```bash
apt install -y memcached python3-memcache
sed -i 's/-l 127.0.0.1/-l 0.0.0.0/' /etc/memcached.conf
systemctl restart memcached && systemctl enable memcached
```

✅ 验证：执行 `echo "stats" | nc controller 11211`，应返回 memcached 状态信息（没有 `nc` 时先 `apt install -y netcat-openbsd`）。

### 2.4 安装 nginx

```bash
apt install -y nginx libnginx-mod-stream
unlink /etc/nginx/sites-enabled/default
```

> 注意：删除默认站点是为了不让 nginx 占用 80 端口，后面 Horizon 由 Apache 监听 80。

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
apt install -y keystone apache2 libapache2-mod-wsgi-py3 python3-oauth2client crudini

# 备份原始配置
cp /etc/keystone/keystone.conf /etc/keystone/keystone.conf.bak

# 修改配置（按节修改，不依赖行号）
crudini --set /etc/keystone/keystone.conf cache memcache_servers localhost:11211
crudini --set /etc/keystone/keystone.conf database connection mysql+pymysql://keystone:ChangeMe123@localhost/keystone
crudini --set /etc/keystone/keystone.conf token provider fernet

# 初始化数据库
su -s /bin/sh -c "keystone-manage db_sync" keystone
# 如果出现 "AttributeError: 'NoneType' object has no attribute 'getcurrent'"，
# 这是 eventlet 与 Python 3.11 的已知问题，不影响数据库同步结果

# 初始化 Fernet 密钥
keystone-manage fernet_setup --keystone-user keystone --keystone-group keystone
keystone-manage credential_setup --keystone-user keystone --keystone-group keystone

# 引导身份服务
keystone-manage bootstrap --bootstrap-password ChangeMe123 \
  --bootstrap-admin-url http://controller:5000/v3/ \
  --bootstrap-internal-url http://controller:5000/v3/ \
  --bootstrap-public-url http://controller:5000/v3/ \
  --bootstrap-region-id RegionOne

# 配置 Apache
echo "ServerName controller" >> /etc/apache2/apache2.conf

cat > /etc/apache2/sites-available/keystone.conf << 'EOF'
Listen 5000
<VirtualHost *:5000>
    WSGIScriptAlias / /usr/bin/keystone-wsgi-public
    WSGIDaemonProcess keystone-public processes=5 threads=1 user=keystone group=keystone display-name=%{GROUP}
    WSGIProcessGroup keystone-public
    WSGIApplicationGroup %{GLOBAL}
    WSGIPassAuthorization On
    LimitRequestBody 114688

    ErrorLogFormat "%{cu}t %M"
    ErrorLog /var/log/apache2/keystone.log
    CustomLog /var/log/apache2/keystone_access.log combined

    <Directory /usr/bin>
      Require all granted
    </Directory>
</VirtualHost>
EOF

a2ensite keystone

# 关闭软件包自带的 keystone（uwsgi）服务，避免与 Apache 争用 5000 端口
systemctl disable --now keystone

systemctl restart apache2 && systemctl enable apache2
```

> 注意：原笔记的虚拟主机开启了 `SSLEngine`，但证书文件从未生成，而 bootstrap 注册的 endpoint 和其它服务的配置全是 `http://`，这里统一改为 HTTP。若需要 HTTPS，请先准备证书，再把所有 endpoint 和 `auth_url` 一起改成 `https://`。另外请确认 `/usr/bin/keystone-wsgi-public` 存在（`ls /usr/bin/keystone-wsgi*`），文件名以实际安装的包为准。

### 3.3 创建管理员环境变量文件

```bash
cat > admin-openrc << EOF
export OS_USERNAME=admin
export OS_PASSWORD=ChangeMe123
export OS_PROJECT_NAME=admin
export OS_USER_DOMAIN_NAME=Default
export OS_PROJECT_DOMAIN_NAME=Default
export OS_AUTH_URL=http://controller:5000/v3
export OS_IDENTITY_API_VERSION=3
export OS_IMAGE_API_VERSION=2
EOF
```

✅ 验证：

```bash
source admin-openrc
openstack token issue
```

应成功返回令牌信息，包含有效期和用户 ID。

### 3.4 创建服务项目和用户

```bash
source admin-openrc

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
source admin-openrc

openstack user create --domain default --password ChangeMe123 glance
openstack role add --project service --user glance admin
openstack service create --name glance --description "OpenStack Image" image
openstack endpoint create --region RegionOne image public http://controller:9292
openstack endpoint create --region RegionOne image internal http://controller:9292
openstack endpoint create --region RegionOne image admin http://controller:9292
```

### 4.3 安装和配置 Glance

```bash
apt install -y glance

# 配置 glance-api
cat > /etc/glance/glance-api.conf << 'EOF'
[DEFAULT]
bind_host = 0.0.0.0
bind_port = 9292
transport_url = rabbit://openstack:ChangeMe123@controller:5672/
enable_proxy_headers_parsing = true
debug = false
log_dir = /var/log/glance
show_image_direct_url = true

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

[oslo_messaging_notifications]
driver = messagingv2

[paste_deploy]
flavor = keystone

[glance_store]
default_store = file
stores = file,http
filesystem_store_datadir = /var/lib/glance/images/

[oslo_concurrency]
lock_path = /var/lib/glance/lock

[image_format]
disk_formats = ami,ari,aki,vhd,vhdx,vmdk,raw,qcow2,vdi,iso,ploop
container_formats = ami,ari,aki,bare,ovf,ova,docker
EOF

# 同步数据库
su -s /bin/sh -c "glance-manage db_sync" glance

# 重启服务（Debian 的服务名是 glance-api）
systemctl restart glance-api && systemctl enable glance-api
```

> 注意：原笔记的 glance-api.conf 和 glance-scrubber.conf 有两百多行，其中混入了大量已废弃或不存在的选项（如 `rpc_backend`、`verbose`、`registry_host`、`data_api`），`stores` 里还启用了本文并未部署的 cinder 存储，`disk_formats` 里有 `ploop.root-tar` 这样的笔误。这里只保留单节点文件存储真正需要的配置。scrubber 只负责延迟删除镜像，默认未开启 `delayed_delete` 时不需要单独配置。

### 4.4 下载并上传测试镜像

```bash
source admin-openrc

# 下载 Cirros 镜像到 /opt
wget -q -P /opt http://download.cirros-cloud.net/0.5.2/cirros-0.5.2-x86_64-disk.img

# 上传镜像
openstack image create "cirros" \
  --file /opt/cirros-0.5.2-x86_64-disk.img \
  --disk-format qcow2 \
  --container-format bare \
  --public
```

✅ 验证：执行 `openstack image list`，应看到 cirros 镜像，状态为 `active`。

## 五、Controller 节点：放置服务（Placement）

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
source admin-openrc

openstack user create --domain default --password ChangeMe123 placement
openstack role add --project service --user placement admin
openstack service create --name placement --description "Placement API" placement
openstack endpoint create --region RegionOne placement public http://controller:8778
openstack endpoint create --region RegionOne placement internal http://controller:8778
openstack endpoint create --region RegionOne placement admin http://controller:8778
```

### 5.3 安装和配置 Placement

```bash
apt install -y placement-api

cat > /etc/placement/placement.conf << EOF
[DEFAULT]
debug = false
log_dir = /var/log/placement

[api]
auth_strategy = keystone

[keystone_authtoken]
www_authenticate_uri = http://controller:5000
auth_url = http://controller:5000
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

# 重启服务
systemctl restart placement-api && systemctl enable placement-api
```

> 注意：原笔记在 placement.conf 中写了一个 `[placement]` 节，那是 nova.conf 里的配置，放在这里没有作用，已删除。

✅ 验证：执行 `placement-status upgrade check`，所有检查项应显示 `Success`。

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

> 注意：如果是重装，需要先执行 `DROP DATABASE IF EXISTS nova_api;`（nova、nova_cell0 同理）清理旧库。首次部署不要执行，以免误删数据。

#### 6.1.2 创建 Nova 用户和服务

```bash
source admin-openrc

openstack user create --domain default --password ChangeMe123 nova
openstack role add --project service --user nova admin
openstack service create --name nova --description "OpenStack Compute" compute
openstack endpoint create --region RegionOne compute public http://controller:8774/v2.1
openstack endpoint create --region RegionOne compute internal http://controller:8774/v2.1
openstack endpoint create --region RegionOne compute admin http://controller:8774/v2.1
```

#### 6.1.3 安装和配置 Nova 控制组件

```bash
apt install -y nova-api nova-conductor nova-scheduler nova-novncproxy

cat > /etc/nova/nova.conf << 'EOF'
[DEFAULT]
enabled_apis = osapi_compute,metadata
transport_url = rabbit://openstack:ChangeMe123@controller:5672/
my_ip = 192.168.1.100
state_path = /var/lib/nova
log_dir = /var/log/nova

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
server_listen = 0.0.0.0
server_proxyclient_address = $my_ip
novncproxy_base_url = http://192.168.1.100:6080/vnc_auto.html
EOF

# 同步数据库
su -s /bin/sh -c "nova-manage api_db sync" nova
su -s /bin/sh -c "nova-manage cell_v2 map_cell0" nova
su -s /bin/sh -c "nova-manage cell_v2 create_cell --name=cell1 --verbose" nova
su -s /bin/sh -c "nova-manage db sync" nova

# 重启服务
systemctl restart nova-api nova-conductor nova-scheduler nova-novncproxy
systemctl enable nova-api nova-conductor nova-scheduler nova-novncproxy
```

> 注意：原笔记中的 `use_neutron` 和 `firewall_driver = nova.virt.firewall.NoopFirewallDriver` 在 Zed 中已经移除，删掉即可。RabbitMQ 连接由 `transport_url` 指定，不再需要 `[oslo_messaging_rabbit]` 中的 `rabbit_host` 等旧选项。

### 6.2 Node1 节点：安装计算组件

#### 6.2.1 安装 Nova 计算组件

```bash
apt install -y nova-compute

# 在 node1 上配置 Nova（my_ip 为 node1 自己的管理 IP）
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

[libvirt]
virt_type = kvm

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
server_listen = 0.0.0.0
server_proxyclient_address = \$my_ip
novncproxy_base_url = http://192.168.1.100:6080/vnc_auto.html
EOF

# 检查硬件虚拟化支持，返回 0 则改用 QEMU 软件模拟
egrep -c '(vmx|svm)' /proc/cpuinfo
if [ $(egrep -c '(vmx|svm)' /proc/cpuinfo) -eq 0 ]; then
    echo "Using QEMU virtualization"
    sed -i 's/^virt_type = kvm/virt_type = qemu/' /etc/nova/nova.conf
    [ -f /etc/nova/nova-compute.conf ] && sed -i 's/^virt_type *= *kvm/virt_type = qemu/' /etc/nova/nova-compute.conf
fi

systemctl restart nova-compute && systemctl enable nova-compute
```

> 注意：原笔记把 node1 的 `my_ip` 写成了 controller 的 192.168.1.100，会导致 VNC 控制台和迁移地址指向错误的主机，这里改为 192.168.1.101。另外原笔记中 node1 的 `[neutron]` 节是空的，计算节点没有它就无法为实例绑定网络端口，这里已补上。

#### 6.2.2 在 Controller 上发现计算节点

```bash
# 在 controller 节点执行
source admin-openrc
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
source admin-openrc

openstack user create --domain default --password ChangeMe123 neutron
openstack role add --project service --user neutron admin
openstack service create --name neutron --description "OpenStack Networking" network
openstack endpoint create --region RegionOne network public http://controller:9696
openstack endpoint create --region RegionOne network internal http://controller:9696
openstack endpoint create --region RegionOne network admin http://controller:9696
```

#### 7.1.3 安装和配置 Neutron 服务器组件

```bash
apt install -y neutron-server neutron-plugin-ml2 neutron-linuxbridge-agent neutron-l3-agent neutron-dhcp-agent neutron-metadata-agent

# 加载网桥过滤模块（Linux Bridge 安全组依赖它，node1 上同样要做）
modprobe br_netfilter
echo br_netfilter > /etc/modules-load.d/br_netfilter.conf
cat > /etc/sysctl.d/99-bridge.conf << EOF
net.bridge.bridge-nf-call-iptables = 1
net.bridge.bridge-nf-call-ip6tables = 1
EOF
sysctl --system

cat > /etc/neutron/neutron.conf << EOF
[DEFAULT]
core_plugin = ml2
service_plugins = router
allow_overlapping_ips = true
transport_url = rabbit://openstack:ChangeMe123@controller:5672/
auth_strategy = keystone
notify_nova_on_port_status_changes = true
notify_nova_on_port_data_changes = true

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
project_name = service
username = nova
password = ChangeMe123
region_name = RegionOne

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

[securitygroup]
enable_ipset = true
EOF

# 配置 Linux Bridge 代理（controller 节点，ens224 为 Provider 网卡）
cat > /etc/neutron/plugins/ml2/linuxbridge_agent.ini << EOF
[linux_bridge]
physical_interface_mappings = provider:ens224

[securitygroup]
firewall_driver = neutron.agent.linux.iptables_firewall.IptablesFirewallDriver
enable_security_group = true

[vxlan]
enable_vxlan = false
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

# 配置 L3 代理
cat > /etc/neutron/l3_agent.ini << EOF
[DEFAULT]
interface_driver = linuxbridge
EOF

# 同步数据库
su -s /bin/sh -c "neutron-db-manage --config-file /etc/neutron/neutron.conf --config-file /etc/neutron/plugins/ml2/ml2_conf.ini upgrade head" neutron

# 在 nova.conf 的 [neutron] 节补充元数据代理配置（认证部分已在 6.1.3 写好）
sed -i '/^\[neutron\]/a service_metadata_proxy = true\nmetadata_proxy_shared_secret = ChangeMe123' /etc/nova/nova.conf

# 重启服务
systemctl restart nova-api
systemctl restart neutron-server neutron-linuxbridge-agent neutron-l3-agent neutron-dhcp-agent neutron-metadata-agent
systemctl enable neutron-server neutron-linuxbridge-agent neutron-l3-agent neutron-dhcp-agent neutron-metadata-agent
```

> 注意：原笔记在 6.1.3 里已经写过 `[neutron]` 的认证信息，这里又用 sed 整段追加了一遍，会产生重复的键，所以只追加缺少的两行。

### 7.2 Node1 节点：安装网络代理

#### 7.2.1 安装和配置 Neutron 代理

```bash
# 在 node1 节点执行
apt install -y neutron-linuxbridge-agent bridge-utils

# 与 controller 相同，加载 br_netfilter 并开启 bridge-nf-call-iptables
modprobe br_netfilter
echo br_netfilter > /etc/modules-load.d/br_netfilter.conf
cat > /etc/sysctl.d/99-bridge.conf << EOF
net.bridge.bridge-nf-call-iptables = 1
net.bridge.bridge-nf-call-ip6tables = 1
EOF
sysctl --system

cat > /etc/neutron/neutron.conf << EOF
[DEFAULT]
transport_url = rabbit://openstack:ChangeMe123@controller:5672/
auth_strategy = keystone

[oslo_concurrency]
lock_path = /var/lib/neutron/tmp
EOF

# 配置外部网桥 br-ex（ens224 本身不要再配置 IP）
cat > /etc/network/interfaces.d/br-ex << EOF
auto br-ex
iface br-ex inet static
    address 192.168.20.101
    netmask 255.255.255.0
    bridge_ports ens224
    bridge_stp off
    bridge_maxwait 0
EOF
systemctl restart networking

# 配置 Linux Bridge 代理（node1 节点）：ens224 已在 br-ex 中，用 bridge_mappings 直接映射已有网桥
cat > /etc/neutron/plugins/ml2/linuxbridge_agent.ini << EOF
[linux_bridge]
bridge_mappings = provider:br-ex

[securitygroup]
firewall_driver = neutron.agent.linux.iptables_firewall.IptablesFirewallDriver
enable_security_group = true

[vxlan]
enable_vxlan = false
EOF

systemctl restart neutron-linuxbridge-agent && systemctl enable neutron-linuxbridge-agent
```

> 注意：原笔记先把 ens224 加进了 br-ex，又在代理里写 `physical_interface_mappings = provider:ens224`。这样 linuxbridge-agent 会尝试把一块已经属于 br-ex 的网卡加进自己的 `brq` 网桥，结果失败，所以改为 `bridge_mappings = provider:br-ex`。网桥由 interfaces 文件中的 `bridge_ports` 自动创建，原来手动执行的 `brctl addbr/addif` 也就不需要了。远程操作时 `systemctl restart networking` 可能会断开 SSH，建议在控制台执行。

### 7.3 创建 Provider 网络

```bash
# 在 controller 节点执行
source admin-openrc

# 创建外部网络
openstack network create --share --external --provider-physical-network provider --provider-network-type flat public

# 创建子网
openstack subnet create --network public \
  --subnet-range 192.168.20.0/24 \
  --gateway 192.168.20.1 \
  --allocation-pool start=192.168.20.150,end=192.168.20.200 \
  --dns-nameserver 8.8.8.8 \
  public-subnet
```

✅ 验证：在 controller 执行 `openstack network agent list`，所有 Neutron 代理（包括 node1 上的 Linux bridge agent）都应为 `UP`，Alive 列显示 `:-)`。

## 八、仪表板服务（Horizon）

### 8.1 安装和配置 Horizon

```bash
apt install -y openstack-dashboard openstack-dashboard-apache

# 备份后在原文件末尾追加覆盖项（不要整体覆盖，原文件中还有 SECRET_KEY 等必需配置）
cp /etc/openstack-dashboard/local_settings.py /etc/openstack-dashboard/local_settings.py.bak
cat >> /etc/openstack-dashboard/local_settings.py << 'EOF'

OPENSTACK_HOST = "controller"
ALLOWED_HOSTS = ['*', ]

SESSION_ENGINE = 'django.contrib.sessions.backends.cache'
CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.memcached.MemcachedCache',
        'LOCATION': 'controller:11211',
    }
}

OPENSTACK_KEYSTONE_URL = "http://%s:5000/v3" % OPENSTACK_HOST
OPENSTACK_KEYSTONE_DEFAULT_ROLE = "user"
OPENSTACK_KEYSTONE_MULTIDOMAIN_SUPPORT = True
OPENSTACK_API_VERSIONS = {
    "identity": 3,
    "image": 2,
    "volume": 3,
    "compute": 2,
}
OPENSTACK_KEYSTONE_DEFAULT_DOMAIN = "Default"
OPENSTACK_NEUTRON_NETWORK = {
    'enable_router': False,
    'enable_quotas': False,
    'enable_ipv6': False,
    'enable_distributed_router': False,
    'enable_ha_router': False,
    'enable_fip_topology_check': False,
}
TIME_ZONE = "Asia/Shanghai"
EOF

systemctl reload apache2
```

✅ 验证：浏览器访问 `http://192.168.1.100/horizon`，域填 `Default`，用 `admin / ChangeMe123` 登录。

> 注意：原笔记的访问地址写成了 192.168.20.100，与前文 controller 的管理 IP（192.168.1.100）不一致，这里统一用管理网地址。

## 九、创建虚拟机测试

### 9.1 创建安全组规则

```bash
source admin-openrc

openstack security group rule create --proto icmp default
openstack security group rule create --proto tcp --dst-port 22 default
```

### 9.2 创建虚拟机

```bash
# 创建测试规格
openstack flavor create --ram 512 --disk 1 --vcpus 1 m1.tiny

# 创建虚拟机（直接接入 Provider 网络 public）
openstack server create --flavor m1.tiny \
  --image cirros \
  --nic net-id=$(openstack network show public -f value -c id) \
  --security-group default \
  test-instance

# 等待虚拟机创建完成
sleep 30

# 查看虚拟机状态和分配到的 IP
openstack server list
```

### 9.3 访问虚拟机

本文用的是纯 Provider 网络（没有租户网络和路由器，Horizon 里也关掉了 `enable_router`），实例会直接从 192.168.20.150～200 地址池拿到一个外部网段 IP，**不需要也无法绑定浮动 IP**：

```bash
# 查看实例 IP（例如 192.168.20.150）
openstack server show test-instance -f value -c addresses
```

> 注意：原笔记在这里执行 `openstack floating ip create public` 再绑定到实例。浮动 IP 需要实例所在的租户网络通过路由器连到外部网络，在当前架构下会报 “External network ... is not reachable” 之类的错误。如果确实需要浮动 IP，要另外启用 VXLAN 租户网络并创建路由器。

✅ 验证：

1. 执行 `openstack server list`，虚拟机状态为 `ACTIVE`；
2. 从 192.168.20.0/24 网段的机器执行 `ping 192.168.20.150`（换成实例的实际 IP），能 ping 通；
3. 登录 Horizon，在「项目 → 计算 → 实例」中能看到该虚拟机。

## 十、故障排查命令

```bash
# 检查服务状态（把服务名换成实际服务，例如 nova-compute）
systemctl status nova-compute

# 查看日志
tail -f /var/log/nova/nova-api.log
tail -f /var/log/neutron/neutron-server.log
tail -f /var/log/apache2/error.log

# 网络检查
ip addr show
brctl show
openstack network agent list

# 数据库检查
mysql -u root -pChangeMe123 -e "SHOW DATABASES;"
```

各服务的日志都在 `/var/log/<服务名>/` 下，出错时先看对应日志里的报错，再按报错调整配置。

## 部署完成验证清单

1. [x] Keystone：`openstack token issue` 成功
2. [x] Glance：`openstack image list` 显示 cirros 镜像
3. [x] Placement：`placement-status upgrade check` 全部通过
4. [x] Nova：`openstack compute service list` 所有服务 up
5. [x] Neutron：`openstack network agent list` 所有代理 up
6. [x] Horizon：浏览器访问 `http://192.168.1.100/horizon` 可登录
7. [x] 虚拟机：可创建并获得 Provider 网段 IP，可 ping 通

## 常见问题

1. **`keystone-manage db_sync` 报 `AttributeError: 'NoneType' object has no attribute 'getcurrent'`**：这是 eventlet 与 Python 3.11 的已知兼容问题，数据库表实际已经创建，可以用 `mysql -u root -pChangeMe123 -e "USE keystone; SHOW TABLES;"` 确认后继续。
2. **APT 源写成 trixie**：会把 Debian 12 混装成 Debian 13，OpenStack 版本也随之变成 Epoxy。Debian 12 请使用 bookworm 源，或者使用 osbpo 的 bookworm backports 源。
3. **Keystone 开了 SSL 但没有证书**：Apache 启动失败，或者 `https://` 和 `http://` 混用导致认证失败。要么整体使用 HTTP，要么证书、endpoint、`auth_url` 一起改成 HTTPS。
4. **Glance 服务名**：Debian 上是 `glance-api`，不是 RHEL 系的 `openstack-glance-api`。
5. **node1 的 `my_ip` 写成 controller 的 IP**：VNC 控制台打不开、实例迁移异常，计算节点要写自己的管理 IP。
6. **br-ex 与 linuxbridge-agent 冲突**：网卡已经加入自建网桥时，要用 `bridge_mappings` 映射这个网桥，而不是 `physical_interface_mappings` 映射网卡。
