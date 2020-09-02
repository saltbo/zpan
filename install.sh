#!/bin/sh

shell_dir=$(cd "$(dirname "$0")" || exit;pwd)
if [ ! -d "${shell_dir}/bin" ]; then
  exit
fi

project="zpan"
unameOut="$(uname -s)"
config_dir="/etc/${project}"
test ! -d "${config_dir}" && mkdir "${config_dir}"
cp "${shell_dir}/bin/${project}" /usr/local/bin
cp "${shell_dir}"/deployments/*.yml "${config_dir}"
if [ "${unameOut}" = "Linux" ]; then
    cp "${shell_dir}/deployments/${project}".service /usr/lib/systemd/system
fi