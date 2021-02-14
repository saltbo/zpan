## 配置文件

从v1.5.0版本开始，我们启用了可视化的安装流程，初次安装完成后会生成config.yml的配置文件。

### port
Http端口，默认为8222

### database
这里定义了ZPan的数据库驱动
```yaml
database:
  driver: sqlite3
  dsn: zpan.db
```