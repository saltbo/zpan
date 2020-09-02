#!/bin/sh

if [ ! -d "bin" ]; then
  exit
fi

project="zpan"
unameOut="$(uname -s)"
config_dir="/etc/${project}"
test ! -d "${config_dir}" && mkdir "${config_dir}"
sudo cp bin/"${project}" /usr/local/bin
sudo cp deployments/*.yml "${config_dir}"
if [ "${unameOut}" = "Linux" ]; then
    sudo cp deployments/"${project}".service /usr/lib/systemd/system
fi