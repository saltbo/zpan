// Copyright 2019 Huawei Technologies Co.,Ltd.
// Licensed under the Apache License, Version 2.0 (the "License"); you may not use
// this file except in compliance with the License.  You may obtain a copy of the
// License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software distributed
// under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
// CONDITIONS OF ANY KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations under the License.

package obs

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"strings"
)

// ObsClient defines OBS client.
type ObsClient struct {
	conf       *config
	httpClient *http.Client
}

// New creates a new ObsClient instance.
func New(ak, sk, endpoint string, configurers ...configurer) (*ObsClient, error) {
	conf := &config{endpoint: endpoint}
	conf.securityProviders = make([]securityProvider, 0, 3)
	conf.securityProviders = append(conf.securityProviders, NewBasicSecurityProvider(ak, sk, ""))

	conf.maxRetryCount = -1
	conf.maxRedirectCount = -1
	for _, configurer := range configurers {
		configurer(conf)
	}

	if err := conf.initConfigWithDefault(); err != nil {
		return nil, err
	}
	err := conf.getTransport()
	if err != nil {
		return nil, err
	}

	if isWarnLogEnabled() {
		info := make([]string, 3)
		info[0] = fmt.Sprintf("[OBS SDK Version=%s", obsSdkVersion)
		info[1] = fmt.Sprintf("Endpoint=%s", conf.endpoint)
		accessMode := "Virtual Hosting"
		if conf.pathStyle {
			accessMode = "Path"
		}
		info[2] = fmt.Sprintf("Access Mode=%s]", accessMode)
		doLog(LEVEL_WARN, strings.Join(info, "];["))
	}
	doLog(LEVEL_DEBUG, "Create obsclient with config:\n%s\n", conf)
	obsClient := &ObsClient{conf: conf, httpClient: &http.Client{Transport: conf.transport, CheckRedirect: checkRedirectFunc}}
	return obsClient, nil
}

// Refresh refreshes ak, sk and securityToken for obsClient.
func (obsClient ObsClient) Refresh(ak, sk, securityToken string) {
	for _, sp := range obsClient.conf.securityProviders {
		if bsp, ok := sp.(*BasicSecurityProvider); ok {
			bsp.refresh(strings.TrimSpace(ak), strings.TrimSpace(sk), strings.TrimSpace(securityToken))
			break
		}
	}
}

func (obsClient ObsClient) getSecurity() securityHolder {
	if obsClient.conf.securityProviders != nil {
		for _, sp := range obsClient.conf.securityProviders {
			if sp == nil {
				continue
			}
			sh := sp.getSecurity()
			if sh.ak != "" && sh.sk != "" {
				return sh
			}
		}
	}
	return emptySecurityHolder
}

// Close closes ObsClient.
func (obsClient ObsClient) Close() {
	obsClient.httpClient = nil
	obsClient.conf.transport.CloseIdleConnections()
	obsClient.conf = nil
}

// ListBuckets lists buckets.
//
// You can use this API to obtain the bucket list. In the list, bucket names are displayed in lexicographical order.
func (obsClient ObsClient) ListBuckets(input *ListBucketsInput, extensions ...extensionOptions) (output *ListBucketsOutput, err error) {
	if input == nil {
		input = &ListBucketsInput{}
	}
	output = &ListBucketsOutput{}
	err = obsClient.doActionWithoutBucket("ListBuckets", HTTP_GET, input, output, extensions)
	if err != nil {
		output = nil
	}
	return
}

// CreateBucket creates a bucket.
//
// You can use this API to create a bucket and name it as you specify. The created bucket name must be unique in OBS.
func (obsClient ObsClient) CreateBucket(input *CreateBucketInput, extensions ...extensionOptions) (output *BaseModel, err error) {
	if input == nil {
		return nil, errors.New("CreateBucketInput is nil")
	}
	output = &BaseModel{}
	err = obsClient.doActionWithBucket("CreateBucket", HTTP_PUT, input.Bucket, input, output, extensions)
	if err != nil {
		output = nil
	}
	return
}

// DeleteBucket deletes a bucket.
//
// You can use this API to delete a bucket. The bucket to be deleted must be empty
// (containing no objects, noncurrent object versions, or part fragments).
func (obsClient ObsClient) DeleteBucket(bucketName string, extensions ...extensionOptions) (output *BaseModel, err error) {
	output = &BaseModel{}
	err = obsClient.doActionWithBucket("DeleteBucket", HTTP_DELETE, bucketName, defaultSerializable, output, extensions)
	if err != nil {
		output = nil
	}
	return
}

// SetBucketStoragePolicy sets bucket storage class.
//
// You can use this API to set storage class for bucket.
func (obsClient ObsClient) SetBucketStoragePolicy(input *SetBucketStoragePolicyInput, extensions ...extensionOptions) (output *BaseModel, err error) {
	if input == nil {
		return nil, errors.New("SetBucketStoragePolicyInput is nil")
	}
	output = &BaseModel{}
	err = obsClient.doActionWithBucket("SetBucketStoragePolicy", HTTP_PUT, input.Bucket, input, output, extensions)
	if err != nil {
		output = nil
	}
	return
}
func (obsClient ObsClient) getBucketStoragePolicyS3(bucketName string, extensions []extensionOptions) (output *GetBucketStoragePolicyOutput, err error) {
	output = &GetBucketStoragePolicyOutput{}
	var outputS3 *getBucketStoragePolicyOutputS3
	outputS3 = &getBucketStoragePolicyOutputS3{}
	err = obsClient.doActionWithBucket("GetBucketStoragePolicy", HTTP_GET, bucketName, newSubResourceSerial(SubResourceStoragePolicy), outputS3, extensions)
	if err != nil {
		output = nil
		return
	}
	output.BaseModel = outputS3.BaseModel
	output.StorageClass = fmt.Sprintf("%s", outputS3.StorageClass)
	return
}

func (obsClient ObsClient) getBucketStoragePolicyObs(bucketName string, extensions []extensionOptions) (output *GetBucketStoragePolicyOutput, err error) {
	output = &GetBucketStoragePolicyOutput{}
	var outputObs *getBucketStoragePolicyOutputObs
	outputObs = &getBucketStoragePolicyOutputObs{}
	err = obsClient.doActionWithBucket("GetBucketStoragePolicy", HTTP_GET, bucketName, newSubResourceSerial(SubResourceStorageClass), outputObs, extensions)
	if err != nil {
		output = nil
		return
	}
	output.BaseModel = outputObs.BaseModel
	output.StorageClass = outputObs.StorageClass
	return
}

// GetBucketStoragePolicy gets bucket storage class.
//
// You can use this API to obtain the storage class of a bucket.
func (obsClient ObsClient) GetBucketStoragePolicy(bucketName string, extensions ...extensionOptions) (output *GetBucketStoragePolicyOutput, err error) {
	if obsClient.conf.signature == SignatureObs {
		return obsClient.getBucketStoragePolicyObs(bucketName, extensions)
	}
	return obsClient.getBucketStoragePolicyS3(bucketName, extensions)
}

// ListObjects lists objects in a bucket.
//
// You can use this API to list objects in a bucket. By default, a maximum of 1000 objects are listed.
func (obsClient ObsClient) ListObjects(input *ListObjectsInput, extensions ...extensionOptions) (output *ListObjectsOutput, err error) {
	if input == nil {
		return nil, errors.New("ListObjectsInput is nil")
	}
	output = &ListObjectsOutput{}
	err = obsClient.doActionWithBucket("ListObjects", HTTP_GET, input.Bucket, input, output, extensions)
	if err != nil {
		output = nil
	} else {
		if location, ok := output.ResponseHeaders[HEADER_BUCKET_REGION]; ok {
			output.Location = location[0]
		}
	}
	return
}

// ListVersions lists versioning objects in a bucket.
//
// You can use this API to list versioning objects in a bucket. By default, a maximum of 1000 versioning objects are listed.
func (obsClient ObsClient) ListVersions(input *ListVersionsInput, extensions ...extensionOptions) (output *ListVersionsOutput, err error) {
	if input == nil {
		return nil, errors.New("ListVersionsInput is nil")
	}
	output = &ListVersionsOutput{}
	err = obsClient.doActionWithBucket("ListVersions", HTTP_GET, input.Bucket, input, output, extensions)
	if err != nil {
		output = nil
	} else {
		if location, ok := output.ResponseHeaders[HEADER_BUCKET_REGION]; ok {
			output.Location = location[0]
		}
	}
	return
}

// ListMultipartUploads lists the multipart uploads.
//
// You can use this API to list the multipart uploads that are initialized but not combined or aborted in a specified bucket.
func (obsClient ObsClient) ListMultipartUploads(input *ListMultipartUploadsInput, extensions ...extensionOptions) (output *ListMultipartUploadsOutput, err error) {
	if input == nil {
		return nil, errors.New("ListMultipartUploadsInput is nil")
	}
	output = &ListMultipartUploadsOutput{}
	err = obsClient.doActionWithBucket("ListMultipartUploads", HTTP_GET, input.Bucket, input, output, extensions)
	if err != nil {
		output = nil
	}
	return
}

// SetBucketQuota sets the bucket quota.
//
// You can use this API to set the bucket quota. A bucket quota must be expressed in bytes and the maximum value is 2^63-1.
func (obsClient ObsClient) SetBucketQuota(input *SetBucketQuotaInput, extensions ...extensionOptions) (output *BaseModel, err error) {
	if input == nil {
		return nil, errors.New("SetBucketQuotaInput is nil")
	}
	output = &BaseModel{}
	err = obsClient.doActionWithBucket("SetBucketQuota", HTTP_PUT, input.Bucket, input, output, extensions)
	if err != nil {
		output = nil
	}
	return
}

// GetBucketQuota gets the bucket quota.
//
// You can use this API to obtain the bucket quota. Value 0 indicates that no upper limit is set for the bucket quota.
func (obsClient ObsClient) GetBucketQuota(bucketName string, extensions ...extensionOptions) (output *GetBucketQuotaOutput, err error) {
	output = &GetBucketQuotaOutput{}
	err = obsClient.doActionWithBucket("GetBucketQuota", HTTP_GET, bucketName, newSubResourceSerial(SubResourceQuota), output, extensions)
	if err != nil {
		output = nil
	}
	return
}

// HeadBucket checks whether a bucket exists.
//
// You can use this API to check whether a bucket exists.
func (obsClient ObsClient) HeadBucket(bucketName string, extensions ...extensionOptions) (output *BaseModel, err error) {
	output = &BaseModel{}
	err = obsClient.doActionWithBucket("HeadBucket", HTTP_HEAD, bucketName, defaultSerializable, output, extensions)
	if err != nil {
		output = nil
	}
	return
}

// HeadObject checks whether an object exists.
//
// You can use this API to check whether an object exists.
func (obsClient ObsClient) HeadObject(input *HeadObjectInput, extensions ...extensionOptions) (output *BaseModel, err error) {
	if input == nil {
		return nil, errors.New("HeadObjectInput is nil")
	}
	output = &BaseModel{}
	err = obsClient.doActionWithBucketAndKey("HeadObject", HTTP_HEAD, input.Bucket, input.Key, input, output, extensions)
	if err != nil {
		output = nil
	}
	return
}

// GetBucketMetadata gets the metadata of a bucket.
//
// You can use this API to send a HEAD request to a bucket to obtain the bucket
// metadata such as the storage class and CORS rules (if set).
func (obsClient ObsClient) GetBucketMetadata(input *GetBucketMetadataInput, extensions ...extensionOptions) (output *GetBucketMetadataOutput, err error) {
	output = &GetBucketMetadataOutput{}
	err = obsClient.doActionWithBucket("GetBucketMetadata", HTTP_HEAD, input.Bucket, input, output, extensions)
	if err != nil {
		output = nil
	} else {
		ParseGetBucketMetadataOutput(output)
	}
	return
}

// SetObjectMetadata sets object metadata.
func (obsClient ObsClient) SetObjectMetadata(input *SetObjectMetadataInput, extensions ...extensionOptions) (output *SetObjectMetadataOutput, err error) {
	output = &SetObjectMetadataOutput{}
	err = obsClient.doActionWithBucketAndKey("SetObjectMetadata", HTTP_PUT, input.Bucket, input.Key, input, output, extensions)
	if err != nil {
		output = nil
	} else {
		ParseSetObjectMetadataOutput(output)
	}
	return
}

// GetBucketStorageInfo gets storage information about a bucket.
//
// You can use this API to obtain storage information about a bucket, including the
// bucket size and number of objects in the bucket.
func (obsClient ObsClient) GetBucketStorageInfo(bucketName string, extensions ...extensionOptions) (output *GetBucketStorageInfoOutput, err error) {
	output = &GetBucketStorageInfoOutput{}
	err = obsClient.doActionWithBucket("GetBucketStorageInfo", HTTP_GET, bucketName, newSubResourceSerial(SubResourceStorageInfo), output, extensions)
	if err != nil {
		output = nil
	}
	return
}

func (obsClient ObsClient) getBucketLocationS3(bucketName string, extensions []extensionOptions) (output *GetBucketLocationOutput, err error) {
	output = &GetBucketLocationOutput{}
	var outputS3 *getBucketLocationOutputS3
	outputS3 = &getBucketLocationOutputS3{}
	err = obsClient.doActionWithBucket("GetBucketLocation", HTTP_GET, bucketName, newSubResourceSerial(SubResourceLocation), outputS3, extensions)
	if err != nil {
		output = nil
	} else {
		output.BaseModel = outputS3.BaseModel
		output.Location = outputS3.Location
	}
	return
}
func (obsClient ObsClient) getBucketLocationObs(bucketName string, extensions []extensionOptions) (output *GetBucketLocationOutput, err error) {
	output = &GetBucketLocationOutput{}
	var outputObs *getBucketLocationOutputObs
	outputObs = &getBucketLocationOutputObs{}
	err = obsClient.doActionWithBucket("GetBucketLocation", HTTP_GET, bucketName, newSubResourceSerial(SubResourceLocation), outputObs, extensions)
	if err != nil {
		output = nil
	} else {
		output.BaseModel = outputObs.BaseModel
		output.Location = outputObs.Location
	}
	return
}

// GetBucketLocation gets the location of a bucket.
//
// You can use this API to obtain the bucket location.
func (obsClient ObsClient) GetBucketLocation(bucketName string, extensions ...extensionOptions) (output *GetBucketLocationOutput, err error) {
	if obsClient.conf.signature == SignatureObs {
		return obsClient.getBucketLocationObs(bucketName, extensions)
	}
	return obsClient.getBucketLocationS3(bucketName, extensions)
}

// SetBucketAcl sets the bucket ACL.
//
// You can use this API to set the ACL for a bucket.
func (obsClient ObsClient) SetBucketAcl(input *SetBucketAclInput, extensions ...extensionOptions) (output *BaseModel, err error) {
	if input == nil {
		return nil, errors.New("SetBucketAclInput is nil")
	}
	output = &BaseModel{}
	err = obsClient.doActionWithBucket("SetBucketAcl", HTTP_PUT, input.Bucket, input, output, extensions)
	if err != nil {
		output = nil
	}
	return
}
func (obsClient ObsClient) getBucketACLObs(bucketName string, extensions []extensionOptions) (output *GetBucketAclOutput, err error) {
	output = &GetBucketAclOutput{}
	var outputObs *getBucketACLOutputObs
	outputObs = &getBucketACLOutputObs{}
	err = obsClient.doActionWithBucket("GetBucketAcl", HTTP_GET, bucketName, newSubResourceSerial(SubResourceAcl), outputObs, extensions)
	if err != nil {
		output = nil
	} else {
		output.BaseModel = outputObs.BaseModel
		output.Owner = outputObs.Owner
		output.Grants = make([]Grant, 0, len(outputObs.Grants))
		for _, valGrant := range outputObs.Grants {
			tempOutput := Grant{}
			tempOutput.Delivered = valGrant.Delivered
			tempOutput.Permission = valGrant.Permission
			tempOutput.Grantee.DisplayName = valGrant.Grantee.DisplayName
			tempOutput.Grantee.ID = valGrant.Grantee.ID
			tempOutput.Grantee.Type = valGrant.Grantee.Type
			tempOutput.Grantee.URI = GroupAllUsers

			output.Grants = append(output.Grants, tempOutput)
		}
	}
	return
}

// GetBucketAcl gets the bucket ACL.
//
// You can use this API to obtain a bucket ACL.
func (obsClient ObsClient) GetBucketAcl(bucketName string, extensions ...extensionOptions) (output *GetBucketAclOutput, err error) {
	output = &GetBucketAclOutput{}
	if obsClient.conf.signature == SignatureObs {
		return obsClient.getBucketACLObs(bucketName, extensions)
	}
	err = obsClient.doActionWithBucket("GetBucketAcl", HTTP_GET, bucketName, newSubResourceSerial(SubResourceAcl), output, extensions)
	if err != nil {
		output = nil
	}
	return
}

// SetBucketPolicy sets the bucket policy.
//
// You can use this API to set a bucket policy. If the bucket already has a policy, the
// policy will be overwritten by the one specified in this request.
func (obsClient ObsClient) SetBucketPolicy(input *SetBucketPolicyInput, extensions ...extensionOptions) (output *BaseModel, err error) {
	if input == nil {
		return nil, errors.New("SetBucketPolicy is nil")
	}
	output = &BaseModel{}
	err = obsClient.doActionWithBucket("SetBucketPolicy", HTTP_PUT, input.Bucket, input, output, extensions)
	if err != nil {
		output = nil
	}
	return
}

// GetBucketPolicy gets the bucket policy.
//
// You can use this API to obtain the policy of a bucket.
func (obsClient ObsClient) GetBucketPolicy(bucketName string, extensions ...extensionOptions) (output *GetBucketPolicyOutput, err error) {
	output = &GetBucketPolicyOutput{}
	err = obsClient.doActionWithBucketV2("GetBucketPolicy", HTTP_GET, bucketName, newSubResourceSerial(SubResourcePolicy), output, extensions)
	if err != nil {
		output = nil
	}
	return
}

// DeleteBucketPolicy deletes the bucket policy.
//
// You can use this API to delete the policy of a bucket.
func (obsClient ObsClient) DeleteBucketPolicy(bucketName string, extensions ...extensionOptions) (output *BaseModel, err error) {
	output = &BaseModel{}
	err = obsClient.doActionWithBucket("DeleteBucketPolicy", HTTP_DELETE, bucketName, newSubResourceSerial(SubResourcePolicy), output, extensions)
	if err != nil {
		output = nil
	}
	return
}

// SetBucketCors sets CORS rules for a bucket.
//
// You can use this API to set CORS rules for a bucket to allow client browsers to send cross-origin requests.
func (obsClient ObsClient) SetBucketCors(input *SetBucketCorsInput, extensions ...extensionOptions) (output *BaseModel, err error) {
	if input == nil {
		return nil, errors.New("SetBucketCorsInput is nil")
	}
	output = &BaseModel{}
	err = obsClient.doActionWithBucket("SetBucketCors", HTTP_PUT, input.Bucket, input, output, extensions)
	if err != nil {
		output = nil
	}
	return
}

// GetBucketCors gets CORS rules of a bucket.
//
// You can use this API to obtain the CORS rules of a specified bucket.
func (obsClient ObsClient) GetBucketCors(bucketName string, extensions ...extensionOptions) (output *GetBucketCorsOutput, err error) {
	output = &GetBucketCorsOutput{}
	err = obsClient.doActionWithBucket("GetBucketCors", HTTP_GET, bucketName, newSubResourceSerial(SubResourceCors), output, extensions)
	if err != nil {
		output = nil
	}
	return
}

// DeleteBucketCors deletes CORS rules of a bucket.
//
// You can use this API to delete the CORS rules of a specified bucket.
func (obsClient ObsClient) DeleteBucketCors(bucketName string, extensions ...extensionOptions) (output *BaseModel, err error) {
	output = &BaseModel{}
	err = obsClient.doActionWithBucket("DeleteBucketCors", HTTP_DELETE, bucketName, newSubResourceSerial(SubResourceCors), output, extensions)
	if err != nil {
		output = nil
	}
	return
}

// SetBucketVersioning sets the versioning status for a bucket.
//
// You can use this API to set the versioning status for a bucket.
func (obsClient ObsClient) SetBucketVersioning(input *SetBucketVersioningInput, extensions ...extensionOptions) (output *BaseModel, err error) {
	if input == nil {
		return nil, errors.New("SetBucketVersioningInput is nil")
	}
	output = &BaseModel{}
	err = obsClient.doActionWithBucket("SetBucketVersioning", HTTP_PUT, input.Bucket, input, output, extensions)
	if err != nil {
		output = nil
	}
	return
}

// GetBucketVersioning gets the versioning status of a bucket.
//
// You can use this API to obtain the versioning status of a bucket.
func (obsClient ObsClient) GetBucketVersioning(bucketName string, extensions ...extensionOptions) (output *GetBucketVersioningOutput, err error) {
	output = &GetBucketVersioningOutput{}
	err = obsClient.doActionWithBucket("GetBucketVersioning", HTTP_GET, bucketName, newSubResourceSerial(SubResourceVersioning), output, extensions)
	if err != nil {
		output = nil
	}
	return
}

// SetBucketWebsiteConfiguration sets website hosting for a bucket.
//
// You can use this API to set website hosting for a bucket.
func (obsClient ObsClient) SetBucketWebsiteConfiguration(input *SetBucketWebsiteConfigurationInput, extensions ...extensionOptions) (output *BaseModel, err error) {
	if input == nil {
		return nil, errors.New("SetBucketWebsiteConfigurationInput is nil")
	}
	output = &BaseModel{}
	err = obsClient.doActionWithBucket("SetBucketWebsiteConfiguration", HTTP_PUT, input.Bucket, input, output, extensions)
	if err != nil {
		output = nil
	}
	return
}

// GetBucketWebsiteConfiguration gets the website hosting settings of a bucket.
//
// You can use this API to obtain the website hosting settings of a bucket.
func (obsClient ObsClient) GetBucketWebsiteConfiguration(bucketName string, extensions ...extensionOptions) (output *GetBucketWebsiteConfigurationOutput, err error) {
	output = &GetBucketWebsiteConfigurationOutput{}
	err = obsClient.doActionWithBucket("GetBucketWebsiteConfiguration", HTTP_GET, bucketName, newSubResourceSerial(SubResourceWebsite), output, extensions)
	if err != nil {
		output = nil
	}
	return
}

// DeleteBucketWebsiteConfiguration deletes the website hosting settings of a bucket.
//
// You can use this API to delete the website hosting settings of a bucket.
func (obsClient ObsClient) DeleteBucketWebsiteConfiguration(bucketName string, extensions ...extensionOptions) (output *BaseModel, err error) {
	output = &BaseModel{}
	err = obsClient.doActionWithBucket("DeleteBucketWebsiteConfiguration", HTTP_DELETE, bucketName, newSubResourceSerial(SubResourceWebsite), output, extensions)
	if err != nil {
		output = nil
	}
	return
}

// SetBucketLoggingConfiguration sets the bucket logging.
//
// You can use this API to configure access logging for a bucket.
func (obsClient ObsClient) SetBucketLoggingConfiguration(input *SetBucketLoggingConfigurationInput, extensions ...extensionOptions) (output *BaseModel, err error) {
	if input == nil {
		return nil, errors.New("SetBucketLoggingConfigurationInput is nil")
	}
	output = &BaseModel{}
	err = obsClient.doActionWithBucket("SetBucketLoggingConfiguration", HTTP_PUT, input.Bucket, input, output, extensions)
	if err != nil {
		output = nil
	}
	return
}

// GetBucketLoggingConfiguration gets the logging settings of a bucket.
//
// You can use this API to obtain the access logging settings of a bucket.
func (obsClient ObsClient) GetBucketLoggingConfiguration(bucketName string, extensions ...extensionOptions) (output *GetBucketLoggingConfigurationOutput, err error) {
	output = &GetBucketLoggingConfigurationOutput{}
	err = obsClient.doActionWithBucket("GetBucketLoggingConfiguration", HTTP_GET, bucketName, newSubResourceSerial(SubResourceLogging), output, extensions)
	if err != nil {
		output = nil
	}
	return
}

// SetBucketLifecycleConfiguration sets lifecycle rules for a bucket.
//
// You can use this API to set lifecycle rules for a bucket, to periodically transit
// storage classes of objects and delete objects in the bucket.
func (obsClient ObsClient) SetBucketLifecycleConfiguration(input *SetBucketLifecycleConfigurationInput, extensions ...extensionOptions) (output *BaseModel, err error) {
	if input == nil {
		return nil, errors.New("SetBucketLifecycleConfigurationInput is nil")
	}
	output = &BaseModel{}
	err = obsClient.doActionWithBucket("SetBucketLifecycleConfiguration", HTTP_PUT, input.Bucket, input, output, extensions)
	if err != nil {
		output = nil
	}
	return
}

// GetBucketLifecycleConfiguration gets lifecycle rules of a bucket.
//
// You can use this API to obtain the lifecycle rules of a bucket.
func (obsClient ObsClient) GetBucketLifecycleConfiguration(bucketName string, extensions ...extensionOptions) (output *GetBucketLifecycleConfigurationOutput, err error) {
	output = &GetBucketLifecycleConfigurationOutput{}
	err = obsClient.doActionWithBucket("GetBucketLifecycleConfiguration", HTTP_GET, bucketName, newSubResourceSerial(SubResourceLifecycle), output, extensions)
	if err != nil {
		output = nil
	}
	return
}

// DeleteBucketLifecycleConfiguration deletes lifecycle rules of a bucket.
//
// You can use this API to delete all lifecycle rules of a bucket.
func (obsClient ObsClient) DeleteBucketLifecycleConfiguration(bucketName string, extensions ...extensionOptions) (output *BaseModel, err error) {
	output = &BaseModel{}
	err = obsClient.doActionWithBucket("DeleteBucketLifecycleConfiguration", HTTP_DELETE, bucketName, newSubResourceSerial(SubResourceLifecycle), output, extensions)
	if err != nil {
		output = nil
	}
	return
}

// SetBucketTagging sets bucket tags.
//
// You can use this API to set bucket tags.
func (obsClient ObsClient) SetBucketTagging(input *SetBucketTaggingInput, extensions ...extensionOptions) (output *BaseModel, err error) {
	if input == nil {
		return nil, errors.New("SetBucketTaggingInput is nil")
	}
	output = &BaseModel{}
	err = obsClient.doActionWithBucket("SetBucketTagging", HTTP_PUT, input.Bucket, input, output, extensions)
	if err != nil {
		output = nil
	}
	return
}

// GetBucketTagging gets bucket tags.
//
// You can use this API to obtain the tags of a specified bucket.
func (obsClient ObsClient) GetBucketTagging(bucketName string, extensions ...extensionOptions) (output *GetBucketTaggingOutput, err error) {
	output = &GetBucketTaggingOutput{}
	err = obsClient.doActionWithBucket("GetBucketTagging", HTTP_GET, bucketName, newSubResourceSerial(SubResourceTagging), output, extensions)
	if err != nil {
		output = nil
	}
	return
}

// DeleteBucketTagging deletes bucket tags.
//
// You can use this API to delete the tags of a specified bucket.
func (obsClient ObsClient) DeleteBucketTagging(bucketName string, extensions ...extensionOptions) (output *BaseModel, err error) {
	output = &BaseModel{}
	err = obsClient.doActionWithBucket("DeleteBucketTagging", HTTP_DELETE, bucketName, newSubResourceSerial(SubResourceTagging), output, extensions)
	if err != nil {
		output = nil
	}
	return
}

// SetBucketNotification sets event notification for a bucket.
//
// You can use this API to configure event notification for a bucket. You will be notified of all
// specified operations performed on the bucket.
func (obsClient ObsClient) SetBucketNotification(input *SetBucketNotificationInput, extensions ...extensionOptions) (output *BaseModel, err error) {
	if input == nil {
		return nil, errors.New("SetBucketNotificationInput is nil")
	}
	output = &BaseModel{}
	err = obsClient.doActionWithBucket("SetBucketNotification", HTTP_PUT, input.Bucket, input, output, extensions)
	if err != nil {
		output = nil
	}
	return
}

// GetBucketNotification gets event notification settings of a bucket.
//
// You can use this API to obtain the event notification configuration of a bucket.
func (obsClient ObsClient) GetBucketNotification(bucketName string, extensions ...extensionOptions) (output *GetBucketNotificationOutput, err error) {
	if obsClient.conf.signature != SignatureObs {
		return obsClient.getBucketNotificationS3(bucketName, extensions)
	}
	output = &GetBucketNotificationOutput{}
	err = obsClient.doActionWithBucket("GetBucketNotification", HTTP_GET, bucketName, newSubResourceSerial(SubResourceNotification), output, extensions)
	if err != nil {
		output = nil
	}
	return
}

func (obsClient ObsClient) getBucketNotificationS3(bucketName string, extensions []extensionOptions) (output *GetBucketNotificationOutput, err error) {
	outputS3 := &getBucketNotificationOutputS3{}
	err = obsClient.doActionWithBucket("GetBucketNotification", HTTP_GET, bucketName, newSubResourceSerial(SubResourceNotification), outputS3, extensions)
	if err != nil {
		return nil, err
	}

	output = &GetBucketNotificationOutput{}
	output.BaseModel = outputS3.BaseModel
	topicConfigurations := make([]TopicConfiguration, 0, len(outputS3.TopicConfigurations))
	for _, topicConfigurationS3 := range outputS3.TopicConfigurations {
		topicConfiguration := TopicConfiguration{}
		topicConfiguration.ID = topicConfigurationS3.ID
		topicConfiguration.Topic = topicConfigurationS3.Topic
		topicConfiguration.FilterRules = topicConfigurationS3.FilterRules

		events := make([]EventType, 0, len(topicConfigurationS3.Events))
		for _, event := range topicConfigurationS3.Events {
			events = append(events, ParseStringToEventType(event))
		}
		topicConfiguration.Events = events
		topicConfigurations = append(topicConfigurations, topicConfiguration)
	}
	output.TopicConfigurations = topicConfigurations
	return
}

// DeleteObject deletes an object.
//
// You can use this API to delete an object from a specified bucket.
func (obsClient ObsClient) DeleteObject(input *DeleteObjectInput, extensions ...extensionOptions) (output *DeleteObjectOutput, err error) {
	if input == nil {
		return nil, errors.New("DeleteObjectInput is nil")
	}
	output = &DeleteObjectOutput{}
	err = obsClient.doActionWithBucketAndKey("DeleteObject", HTTP_DELETE, input.Bucket, input.Key, input, output, extensions)
	if err != nil {
		output = nil
	} else {
		ParseDeleteObjectOutput(output)
	}
	return
}

// DeleteObjects deletes objects in a batch.
//
// You can use this API to batch delete objects from a specified bucket.
func (obsClient ObsClient) DeleteObjects(input *DeleteObjectsInput, extensions ...extensionOptions) (output *DeleteObjectsOutput, err error) {
	if input == nil {
		return nil, errors.New("DeleteObjectsInput is nil")
	}
	output = &DeleteObjectsOutput{}
	err = obsClient.doActionWithBucket("DeleteObjects", HTTP_POST, input.Bucket, input, output, extensions)
	if err != nil {
		output = nil
	}
	return
}

// SetObjectAcl sets ACL for an object.
//
// You can use this API to set the ACL for an object in a specified bucket.
func (obsClient ObsClient) SetObjectAcl(input *SetObjectAclInput, extensions ...extensionOptions) (output *BaseModel, err error) {
	if input == nil {
		return nil, errors.New("SetObjectAclInput is nil")
	}
	output = &BaseModel{}
	err = obsClient.doActionWithBucketAndKey("SetObjectAcl", HTTP_PUT, input.Bucket, input.Key, input, output, extensions)
	if err != nil {
		output = nil
	}
	return
}

// GetObjectAcl gets the ACL of an object.
//
// You can use this API to obtain the ACL of an object in a specified bucket.
func (obsClient ObsClient) GetObjectAcl(input *GetObjectAclInput, extensions ...extensionOptions) (output *GetObjectAclOutput, err error) {
	if input == nil {
		return nil, errors.New("GetObjectAclInput is nil")
	}
	output = &GetObjectAclOutput{}
	err = obsClient.doActionWithBucketAndKey("GetObjectAcl", HTTP_GET, input.Bucket, input.Key, input, output, extensions)
	if err != nil {
		output = nil
	} else {
		if versionID, ok := output.ResponseHeaders[HEADER_VERSION_ID]; ok {
			output.VersionId = versionID[0]
		}
	}
	return
}

// RestoreObject restores an object.
func (obsClient ObsClient) RestoreObject(input *RestoreObjectInput, extensions ...extensionOptions) (output *BaseModel, err error) {
	if input == nil {
		return nil, errors.New("RestoreObjectInput is nil")
	}
	output = &BaseModel{}
	err = obsClient.doActionWithBucketAndKey("RestoreObject", HTTP_POST, input.Bucket, input.Key, input, output, extensions)
	if err != nil {
		output = nil
	}
	return
}

// GetObjectMetadata gets object metadata.
//
// You can use this API to send a HEAD request to the object of a specified bucket to obtain its metadata.
func (obsClient ObsClient) GetObjectMetadata(input *GetObjectMetadataInput, extensions ...extensionOptions) (output *GetObjectMetadataOutput, err error) {
	if input == nil {
		return nil, errors.New("GetObjectMetadataInput is nil")
	}
	output = &GetObjectMetadataOutput{}
	err = obsClient.doActionWithBucketAndKey("GetObjectMetadata", HTTP_HEAD, input.Bucket, input.Key, input, output, extensions)
	if err != nil {
		output = nil
	} else {
		ParseGetObjectMetadataOutput(output)
	}
	return
}

// GetObject downloads object.
//
// You can use this API to download an object in a specified bucket.
func (obsClient ObsClient) GetObject(input *GetObjectInput, extensions ...extensionOptions) (output *GetObjectOutput, err error) {
	if input == nil {
		return nil, errors.New("GetObjectInput is nil")
	}
	output = &GetObjectOutput{}
	err = obsClient.doActionWithBucketAndKey("GetObject", HTTP_GET, input.Bucket, input.Key, input, output, extensions)
	if err != nil {
		output = nil
	} else {
		ParseGetObjectOutput(output)
	}
	return
}

// PutObject uploads an object to the specified bucket.
func (obsClient ObsClient) PutObject(input *PutObjectInput, extensions ...extensionOptions) (output *PutObjectOutput, err error) {
	if input == nil {
		return nil, errors.New("PutObjectInput is nil")
	}

	if input.ContentType == "" && input.Key != "" {
		if contentType, ok := mimeTypes[strings.ToLower(input.Key[strings.LastIndex(input.Key, ".")+1:])]; ok {
			input.ContentType = contentType
		}
	}
	output = &PutObjectOutput{}
	var repeatable bool
	if input.Body != nil {
		_, repeatable = input.Body.(*strings.Reader)
		if input.ContentLength > 0 {
			input.Body = &readerWrapper{reader: input.Body, totalCount: input.ContentLength}
		}
	}
	if repeatable {
		err = obsClient.doActionWithBucketAndKey("PutObject", HTTP_PUT, input.Bucket, input.Key, input, output, extensions)
	} else {
		err = obsClient.doActionWithBucketAndKeyUnRepeatable("PutObject", HTTP_PUT, input.Bucket, input.Key, input, output, extensions)
	}
	if err != nil {
		output = nil
	} else {
		ParsePutObjectOutput(output)
	}
	return
}

func (obsClient ObsClient) getContentType(input *PutObjectInput, sourceFile string) (contentType string) {
	if contentType, ok := mimeTypes[strings.ToLower(input.Key[strings.LastIndex(input.Key, ".")+1:])]; ok {
		return contentType
	}
	if contentType, ok := mimeTypes[strings.ToLower(sourceFile[strings.LastIndex(sourceFile, ".")+1:])]; ok {
		return contentType
	}
	return
}

func (obsClient ObsClient) isGetContentType(input *PutObjectInput) bool {
	if input.ContentType == "" && input.Key != "" {
		return true
	}
	return false
}

// PutFile uploads a file to the specified bucket.
func (obsClient ObsClient) PutFile(input *PutFileInput, extensions ...extensionOptions) (output *PutObjectOutput, err error) {
	if input == nil {
		return nil, errors.New("PutFileInput is nil")
	}

	var body io.Reader
	sourceFile := strings.TrimSpace(input.SourceFile)
	if sourceFile != "" {
		fd, _err := os.Open(sourceFile)
		if _err != nil {
			err = _err
			return nil, err
		}
		defer func() {
			errMsg := fd.Close()
			if errMsg != nil {
				doLog(LEVEL_WARN, "Failed to close file with reason: %v", errMsg)
			}
		}()

		stat, _err := fd.Stat()
		if _err != nil {
			err = _err
			return nil, err
		}
		fileReaderWrapper := &fileReaderWrapper{filePath: sourceFile}
		fileReaderWrapper.reader = fd
		if input.ContentLength > 0 {
			if input.ContentLength > stat.Size() {
				input.ContentLength = stat.Size()
			}
			fileReaderWrapper.totalCount = input.ContentLength
		} else {
			fileReaderWrapper.totalCount = stat.Size()
		}
		body = fileReaderWrapper
	}

	_input := &PutObjectInput{}
	_input.PutObjectBasicInput = input.PutObjectBasicInput
	_input.Body = body

	if obsClient.isGetContentType(_input) {
		_input.ContentType = obsClient.getContentType(_input, sourceFile)
	}

	output = &PutObjectOutput{}
	err = obsClient.doActionWithBucketAndKey("PutFile", HTTP_PUT, _input.Bucket, _input.Key, _input, output, extensions)
	if err != nil {
		output = nil
	} else {
		ParsePutObjectOutput(output)
	}
	return
}

// CopyObject creates a copy for an existing object.
//
// You can use this API to create a copy for an object in a specified bucket.
func (obsClient ObsClient) CopyObject(input *CopyObjectInput, extensions ...extensionOptions) (output *CopyObjectOutput, err error) {
	if input == nil {
		return nil, errors.New("CopyObjectInput is nil")
	}

	if strings.TrimSpace(input.CopySourceBucket) == "" {
		return nil, errors.New("Source bucket is empty")
	}
	if strings.TrimSpace(input.CopySourceKey) == "" {
		return nil, errors.New("Source key is empty")
	}

	output = &CopyObjectOutput{}
	err = obsClient.doActionWithBucketAndKey("CopyObject", HTTP_PUT, input.Bucket, input.Key, input, output, extensions)
	if err != nil {
		output = nil
	} else {
		ParseCopyObjectOutput(output)
	}
	return
}

// AbortMultipartUpload aborts a multipart upload in a specified bucket by using the multipart upload ID.
func (obsClient ObsClient) AbortMultipartUpload(input *AbortMultipartUploadInput, extensions ...extensionOptions) (output *BaseModel, err error) {
	if input == nil {
		return nil, errors.New("AbortMultipartUploadInput is nil")
	}
	if input.UploadId == "" {
		return nil, errors.New("UploadId is empty")
	}
	output = &BaseModel{}
	err = obsClient.doActionWithBucketAndKey("AbortMultipartUpload", HTTP_DELETE, input.Bucket, input.Key, input, output, extensions)
	if err != nil {
		output = nil
	}
	return
}

// InitiateMultipartUpload initializes a multipart upload.
func (obsClient ObsClient) InitiateMultipartUpload(input *InitiateMultipartUploadInput, extensions ...extensionOptions) (output *InitiateMultipartUploadOutput, err error) {
	if input == nil {
		return nil, errors.New("InitiateMultipartUploadInput is nil")
	}

	if input.ContentType == "" && input.Key != "" {
		if contentType, ok := mimeTypes[strings.ToLower(input.Key[strings.LastIndex(input.Key, ".")+1:])]; ok {
			input.ContentType = contentType
		}
	}

	output = &InitiateMultipartUploadOutput{}
	err = obsClient.doActionWithBucketAndKey("InitiateMultipartUpload", HTTP_POST, input.Bucket, input.Key, input, output, extensions)
	if err != nil {
		output = nil
	} else {
		ParseInitiateMultipartUploadOutput(output)
	}
	return
}

// UploadPart uploads a part to a specified bucket by using a specified multipart upload ID.
//
// After a multipart upload is initialized, you can use this API to upload a part to a specified bucket
// by using the multipart upload ID. Except for the last uploaded part whose size ranges from 0 to 5 GB,
// sizes of the other parts range from 100 KB to 5 GB. The upload part ID ranges from 1 to 10000.
func (obsClient ObsClient) UploadPart(_input *UploadPartInput, extensions ...extensionOptions) (output *UploadPartOutput, err error) {
	if _input == nil {
		return nil, errors.New("UploadPartInput is nil")
	}

	if _input.UploadId == "" {
		return nil, errors.New("UploadId is empty")
	}

	input := &UploadPartInput{}
	input.Bucket = _input.Bucket
	input.Key = _input.Key
	input.PartNumber = _input.PartNumber
	input.UploadId = _input.UploadId
	input.ContentMD5 = _input.ContentMD5
	input.SourceFile = _input.SourceFile
	input.Offset = _input.Offset
	input.PartSize = _input.PartSize
	input.SseHeader = _input.SseHeader
	input.Body = _input.Body

	output = &UploadPartOutput{}
	var repeatable bool
	if input.Body != nil {
		_, repeatable = input.Body.(*strings.Reader)
		if _, ok := input.Body.(*readerWrapper); !ok && input.PartSize > 0 {
			input.Body = &readerWrapper{reader: input.Body, totalCount: input.PartSize}
		}
	} else if sourceFile := strings.TrimSpace(input.SourceFile); sourceFile != "" {
		fd, _err := os.Open(sourceFile)
		if _err != nil {
			err = _err
			return nil, err
		}
		defer func() {
			errMsg := fd.Close()
			if errMsg != nil {
				doLog(LEVEL_WARN, "Failed to close file with reason: %v", errMsg)
			}
		}()

		stat, _err := fd.Stat()
		if _err != nil {
			err = _err
			return nil, err
		}
		fileSize := stat.Size()
		fileReaderWrapper := &fileReaderWrapper{filePath: sourceFile}
		fileReaderWrapper.reader = fd

		if input.Offset < 0 || input.Offset > fileSize {
			input.Offset = 0
		}

		if input.PartSize <= 0 || input.PartSize > (fileSize-input.Offset) {
			input.PartSize = fileSize - input.Offset
		}
		fileReaderWrapper.totalCount = input.PartSize
		if _, err = fd.Seek(input.Offset, io.SeekStart); err != nil {
			return nil, err
		}
		input.Body = fileReaderWrapper
		repeatable = true
	}
	if repeatable {
		err = obsClient.doActionWithBucketAndKey("UploadPart", HTTP_PUT, input.Bucket, input.Key, input, output, extensions)
	} else {
		err = obsClient.doActionWithBucketAndKeyUnRepeatable("UploadPart", HTTP_PUT, input.Bucket, input.Key, input, output, extensions)
	}
	if err != nil {
		output = nil
	} else {
		ParseUploadPartOutput(output)
		output.PartNumber = input.PartNumber
	}
	return
}

// CompleteMultipartUpload combines the uploaded parts in a specified bucket by using the multipart upload ID.
func (obsClient ObsClient) CompleteMultipartUpload(input *CompleteMultipartUploadInput, extensions ...extensionOptions) (output *CompleteMultipartUploadOutput, err error) {
	if input == nil {
		return nil, errors.New("CompleteMultipartUploadInput is nil")
	}

	if input.UploadId == "" {
		return nil, errors.New("UploadId is empty")
	}

	var parts partSlice = input.Parts
	sort.Sort(parts)

	output = &CompleteMultipartUploadOutput{}
	err = obsClient.doActionWithBucketAndKey("CompleteMultipartUpload", HTTP_POST, input.Bucket, input.Key, input, output, extensions)
	if err != nil {
		output = nil
	} else {
		ParseCompleteMultipartUploadOutput(output)
	}
	return
}

// ListParts lists the uploaded parts in a bucket by using the multipart upload ID.
func (obsClient ObsClient) ListParts(input *ListPartsInput, extensions ...extensionOptions) (output *ListPartsOutput, err error) {
	if input == nil {
		return nil, errors.New("ListPartsInput is nil")
	}
	if input.UploadId == "" {
		return nil, errors.New("UploadId is empty")
	}
	output = &ListPartsOutput{}
	err = obsClient.doActionWithBucketAndKey("ListParts", HTTP_GET, input.Bucket, input.Key, input, output, extensions)
	if err != nil {
		output = nil
	}
	return
}

// CopyPart copy a part to a specified bucket by using a specified multipart upload ID.
//
// After a multipart upload is initialized, you can use this API to copy a part to a specified bucket by using the multipart upload ID.
func (obsClient ObsClient) CopyPart(input *CopyPartInput, extensions ...extensionOptions) (output *CopyPartOutput, err error) {
	if input == nil {
		return nil, errors.New("CopyPartInput is nil")
	}
	if input.UploadId == "" {
		return nil, errors.New("UploadId is empty")
	}
	if strings.TrimSpace(input.CopySourceBucket) == "" {
		return nil, errors.New("Source bucket is empty")
	}
	if strings.TrimSpace(input.CopySourceKey) == "" {
		return nil, errors.New("Source key is empty")
	}

	output = &CopyPartOutput{}
	err = obsClient.doActionWithBucketAndKey("CopyPart", HTTP_PUT, input.Bucket, input.Key, input, output, extensions)
	if err != nil {
		output = nil
	} else {
		ParseCopyPartOutput(output)
		output.PartNumber = input.PartNumber
	}
	return
}

// SetBucketRequestPayment sets requester-pays setting for a bucket.
func (obsClient ObsClient) SetBucketRequestPayment(input *SetBucketRequestPaymentInput, extensions ...extensionOptions) (output *BaseModel, err error) {
	if input == nil {
		return nil, errors.New("SetBucketRequestPaymentInput is nil")
	}
	output = &BaseModel{}
	err = obsClient.doActionWithBucket("SetBucketRequestPayment", HTTP_PUT, input.Bucket, input, output, extensions)
	if err != nil {
		output = nil
	}
	return
}

// GetBucketRequestPayment gets requester-pays setting of a bucket.
func (obsClient ObsClient) GetBucketRequestPayment(bucketName string, extensions ...extensionOptions) (output *GetBucketRequestPaymentOutput, err error) {
	output = &GetBucketRequestPaymentOutput{}
	err = obsClient.doActionWithBucket("GetBucketRequestPayment", HTTP_GET, bucketName, newSubResourceSerial(SubResourceRequestPayment), output, extensions)
	if err != nil {
		output = nil
	}
	return
}

// UploadFile resume uploads.
//
// This API is an encapsulated and enhanced version of multipart upload, and aims to eliminate large file
// upload failures caused by poor network conditions and program breakdowns.
func (obsClient ObsClient) UploadFile(input *UploadFileInput, extensions ...extensionOptions) (output *CompleteMultipartUploadOutput, err error) {
	if input.EnableCheckpoint && input.CheckpointFile == "" {
		input.CheckpointFile = input.UploadFile + ".uploadfile_record"
	}

	if input.TaskNum <= 0 {
		input.TaskNum = 1
	}
	if input.PartSize < MIN_PART_SIZE {
		input.PartSize = MIN_PART_SIZE
	} else if input.PartSize > MAX_PART_SIZE {
		input.PartSize = MAX_PART_SIZE
	}

	output, err = obsClient.resumeUpload(input, extensions)
	return
}

// DownloadFile resume downloads.
//
// This API is an encapsulated and enhanced version of partial download, and aims to eliminate large file
// download failures caused by poor network conditions and program breakdowns.
func (obsClient ObsClient) DownloadFile(input *DownloadFileInput, extensions ...extensionOptions) (output *GetObjectMetadataOutput, err error) {
	if input.DownloadFile == "" {
		input.DownloadFile = input.Key
	}

	if input.EnableCheckpoint && input.CheckpointFile == "" {
		input.CheckpointFile = input.DownloadFile + ".downloadfile_record"
	}

	if input.TaskNum <= 0 {
		input.TaskNum = 1
	}
	if input.PartSize <= 0 {
		input.PartSize = DEFAULT_PART_SIZE
	}

	output, err = obsClient.resumeDownload(input, extensions)
	return
}

// SetBucketFetchPolicy sets the bucket fetch policy.
//
// You can use this API to set a bucket fetch policy.
func (obsClient ObsClient) SetBucketFetchPolicy(input *SetBucketFetchPolicyInput, extensions ...extensionOptions) (output *BaseModel, err error) {
	if input == nil {
		return nil, errors.New("SetBucketFetchPolicyInput is nil")
	}
	if strings.TrimSpace(string(input.Status)) == "" {
		return nil, errors.New("Fetch policy status is empty")
	}
	if strings.TrimSpace(input.Agency) == "" {
		return nil, errors.New("Fetch policy agency is empty")
	}
	output = &BaseModel{}
	err = obsClient.doActionWithBucketAndKey("SetBucketFetchPolicy", HTTP_PUT, input.Bucket, string(objectKeyExtensionPolicy), input, output, extensions)
	if err != nil {
		output = nil
	}
	return
}

// GetBucketFetchPolicy gets the bucket fetch policy.
//
// You can use this API to obtain the fetch policy of a bucket.
func (obsClient ObsClient) GetBucketFetchPolicy(input *GetBucketFetchPolicyInput, extensions ...extensionOptions) (output *GetBucketFetchPolicyOutput, err error) {
	if input == nil {
		return nil, errors.New("GetBucketFetchPolicyInput is nil")
	}
	output = &GetBucketFetchPolicyOutput{}
	err = obsClient.doActionWithBucketAndKeyV2("GetBucketFetchPolicy", HTTP_GET, input.Bucket, string(objectKeyExtensionPolicy), input, output, extensions)
	if err != nil {
		output = nil
	}
	return
}

// DeleteBucketFetchPolicy deletes the bucket fetch policy.
//
// You can use this API to delete the fetch policy of a bucket.
func (obsClient ObsClient) DeleteBucketFetchPolicy(input *DeleteBucketFetchPolicyInput, extensions ...extensionOptions) (output *BaseModel, err error) {
	if input == nil {
		return nil, errors.New("DeleteBucketFetchPolicyInput is nil")
	}
	output = &BaseModel{}
	err = obsClient.doActionWithBucketAndKey("DeleteBucketFetchPolicy", HTTP_DELETE, input.Bucket, string(objectKeyExtensionPolicy), input, output, extensions)
	if err != nil {
		output = nil
	}
	return
}

// SetBucketFetchJob sets the bucket fetch job.
//
// You can use this API to set a bucket fetch job.
func (obsClient ObsClient) SetBucketFetchJob(input *SetBucketFetchJobInput, extensions ...extensionOptions) (output *SetBucketFetchJobOutput, err error) {
	if input == nil {
		return nil, errors.New("SetBucketFetchJobInput is nil")
	}
	if strings.TrimSpace(input.URL) == "" {
		return nil, errors.New("URL is empty")
	}
	output = &SetBucketFetchJobOutput{}
	err = obsClient.doActionWithBucketAndKeyV2("SetBucketFetchJob", HTTP_POST, input.Bucket, string(objectKeyAsyncFetchJob), input, output, extensions)
	if err != nil {
		output = nil
	}
	return
}

// GetBucketFetchJob gets the bucket fetch job.
//
// You can use this API to obtain the fetch job of a bucket.
func (obsClient ObsClient) GetBucketFetchJob(input *GetBucketFetchJobInput, extensions ...extensionOptions) (output *GetBucketFetchJobOutput, err error) {
	if input == nil {
		return nil, errors.New("GetBucketFetchJobInput is nil")
	}
	if strings.TrimSpace(input.JobID) == "" {
		return nil, errors.New("JobID is empty")
	}
	output = &GetBucketFetchJobOutput{}
	err = obsClient.doActionWithBucketAndKeyV2("GetBucketFetchJob", HTTP_GET, input.Bucket, string(objectKeyAsyncFetchJob)+"/"+input.JobID, input, output, extensions)
	if err != nil {
		output = nil
	}
	return
}
