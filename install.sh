#!/bin/sh

shell_dir=$(cd "$(dirname "$0")" || exit;pwd)
if [ ! -d "${shell_dir}/bin" ]; then
  echo "not found bin files"
  exit
fi

project="zpan"
unameOut="$(uname -s)"
config_dir="/etc/${project}"
test ! -d "${config_dir}" && mkdir "${config_dir}"
cp "${shell_dir}/bin/${project}" /usr/local/bin
cp -r "${shell_dir}"/deployments/. "${config_dir}"
if [ "${unameOut}" = "Linux" ]; then
    cp "${shell_dir}/deployments/${project}".service /etc/systemd/system
fi