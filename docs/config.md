# 配置文件

从v1.5.0版本开始，我们启用了可视化的安装流程，初次安装完成后会生成config.yml的配置文件。如果您需要修改端口或者数据库配置，可以打开该文件进行编辑修改。

## port
Http端口，默认为8222

## database
这里定义了ZPan的数据库驱动
```yaml
database:
  driver: sqlite3
  dsn: zpan.db
```

### driver
我们支持四种数据库驱动，您可以根据需求进行选择

- sqlite3
- mysql
- postgres
- mssql

### dsn
不用的驱动对应的dsn也是不一样的，这里我们分别给出每种驱动的dsn格式

|  driver   | dsn  |
|  ----  | ----  |
| sqlite3  | zpan.db |
| mysql  | user:pass@tcp(127.0.0.1:3306)/zpan?charset=utf8mb4&parseTime=True&loc=Local |
| postgres  | user=zpan password=zpan dbname=zpan port=9920 sslmode=disable TimeZone=Asia/Shanghai |
| mssql  | sqlserver://zpan:LoremIpsum86@localhost:9930?database=zpan |