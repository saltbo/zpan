package torrentmeta

import (
	"bytes"
	"testing"
)

func TestInfoDictReturnsTheRawInfoValue(t *testing.T) {
	info := []byte("d6:lengthi12e4:name5:a.mkv12:piece lengthi16384e6:pieces20:aaaaaaaaaaaaaaaaaaaae")
	file := append(append([]byte("d8:announce14:http://t/announce4:info"), info...), []byte("4:sizei3ee")...)
	file = bytes.Replace(file, []byte("14:http://t/announce"), []byte("17:http://t/announce"), 1)
	got, err := InfoDict(file)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, info) {
		t.Fatalf("info = %q", got)
	}
	if bare, err := InfoDict(info); err != nil || !bytes.Equal(bare, info) {
		t.Fatalf("bare info = %q, %v", bare, err)
	}
	if len(InfoHash(info)) != 40 {
		t.Fatal("infoHash is not hex SHA-1")
	}
}

func TestInfoDictRefusesGarbage(t *testing.T) {
	for _, data := range [][]byte{nil, []byte("not bencode"), []byte("d4:info"), []byte("d4:infoi1ee"), []byte("li1ee"), []byte("d3:abc5:xe")} {
		if _, err := InfoDict(data); err == nil {
			t.Errorf("InfoDict(%q) succeeded", data)
		}
	}
}

func TestInfoDictAcceptsTrailingWhitespace(t *testing.T) {
	info := []byte("d4:name1:ae")
	file := append(append([]byte("d4:info"), info...), []byte("e\r\n \t")...)
	if got, err := InfoDict(file); err != nil || !bytes.Equal(got, info) {
		t.Fatalf("info = %q, %v", got, err)
	}
	if _, err := InfoDict(append(file, 'x')); err == nil {
		t.Fatal("trailing data accepted")
	}
}

func TestInfoDictRefusesLengthsPastTheData(t *testing.T) {
	for _, data := range [][]byte{
		[]byte("d4:name99999999999999999999999999999:ae"),
		[]byte("d4:name9223372036854775807:ae"),
		[]byte("d4:name18446744073709551617:ae"),
		[]byte("d4:name3:ae"),
		[]byte("d4:name-1:ae"),
	} {
		if _, err := InfoDict(data); err == nil {
			t.Errorf("InfoDict(%q) succeeded", data)
		}
	}
}
