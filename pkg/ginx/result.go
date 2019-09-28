//  Copyright 2019 The Go Authors. All rights reserved.
//  Use of this source code is governed by a BSD-style
//  license that can be found in the LICENSE file.

package ginx

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
)

type Result struct {
	Code int         `json:"code"`
	Msg  string      `json:"msg"`
	Data interface{} `json:"data,omitempty"`
}

func (r *Result) Error() string {
	if r.Code != 0 {
		return r.Msg
	}

	return ""
}

func (r *Result) Unwrap() error {
	return fmt.Errorf("%w", r.Msg)
}

func RError(code int, err error) error {
	return &Result{Code: code, Msg: err.Error()}
}

func RWithData(code int, msg string, data interface{}) error {
	return &Result{
		Code: code,
		Msg:  msg,
		Data: data,
	}
}

func Error(err error) error {
	return RError(http.StatusBadRequest, err)
}

func Unauthorized(err error) error {
	return RError(http.StatusUnauthorized, err)
}

func Forbidden(err error) error {
	return RError(http.StatusForbidden, err)
}

func Failed(err error) error {
	return RError(http.StatusInternalServerError, err)
}

type ListData struct {
	List     interface{} `json:"list"`
	TotalNum int64       `json:"total_num"`
}

func Json(c *gin.Context, data interface{}) error {
	c.JSON(http.StatusOK, RWithData(0, "ok", data))
	return nil
}

func JsonList(c *gin.Context, list interface{}, totalNum int64) error {
	c.JSON(http.StatusOK, &ListData{list, totalNum})
	return nil
}

func Redirect(c *gin.Context, location string) {
	c.Redirect(http.StatusMovedPermanently, location)
}

func Cookie(c *gin.Context, name, value string) {
	c.SetCookie(name, value, 7*24*3600, "/", "", false, false)
}
