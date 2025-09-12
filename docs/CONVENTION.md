# 프로젝트 네이밍 컨벤션 가이드

## 목차
1. [개요](#개요)
2. [변수명 컨벤션](#변수명-컨벤션)
3. [함수명 컨벤션](#함수명-컨벤션)
4. [클래스명 컨벤션](#클래스명-컨벤션)
5. [상수명 컨벤션](#상수명-컨벤션)
6. [파일 및 폴더 컨벤션](#파일-및-폴더-컨벤션)
7. [API 엔드포인트 컨벤션](#api-엔드포인트-컨벤션)
8. [데이터베이스 컨벤션](#데이터베이스-컨벤션)
9. [특수 상황별 가이드](#특수-상황별-가이드)
10. [금지 사항](#금지-사항)

***

## 개요

이 문서는 코드의 가독성, 유지보수성, 그리고 팀원 간의 일관성을 보장하기 위한 네이밍 컨벤션을 정의합니다.

### 기본 원칙
- **명확성**: 이름만 보고도 역할과 의미를 파악할 수 있어야 함
- **일관성**: 프로젝트 전체에서 동일한 규칙 적용
- **간결성**: 불필요하게 길지 않으면서도 의미 전달이 명확해야 함
- **검색 가능성**: IDE나 에디터에서 쉽게 검색할 수 있어야 함

***

## 변수명 컨벤션

### 기본 규칙
- **camelCase** 사용
- 첫 글자는 소문자
- 의미 있는 단어 조합 사용

```javascript
// ✅ 좋은 예
const userName = 'john';
const totalPrice = 1000;
const userAccountList = [];

// ❌ 나쁜 예
const un = 'john';
const tp = 1000;
const list = [];
```

### Boolean 변수
- **is**, **has**, **can**, **should**, **will** 접두사 사용
- 질문 형태로 작성하여 true/false로 답할 수 있도록 구성

```javascript
// ✅ 좋은 예
const isActive = true;
const hasPermission = false;
const canEdit = true;
const shouldUpdate = false;
const willExpire = true;

// 상태 체크
const isLoading = false;
const isCompleted = true;
const isEmpty = false;

// ❌ 나쁜 예
const active = true;
const permission = false;
const editMode = true;
```

### 배열 변수
- 복수형 사용 또는 **List**, **Array** 접미사 사용

```javascript
// ✅ 좋은 예
const users = [];
const products = [];
const userList = [];
const productArray = [];

// ❌ 나쁜 예
const user = [];
const product = [];
```

### 객체 변수
- 단수형 사용
- 데이터의 성격을 나타내는 명사 사용

```javascript
// ✅ 좋은 예
const user = {};
const productInfo = {};
const orderDetail = {};

// ❌ 나쁜 예
const users = {};
const productInfos = {};
```

***

## 함수명 컨벤션

### 기본 규칙
- **camelCase** 사용
- 동사로 시작
- 함수가 수행하는 동작을 명확히 표현

```javascript
// ✅ 좋은 예
function getUserById(id) { }
function calculateTotalPrice() { }
function validateUserInput() { }

// ❌ 나쁜 예
function user(id) { }
function total() { }
function check() { }
```

### CRUD 작업 함수
```javascript
// Create
function createUser() { }
function addProduct() { }
function insertOrder() { }

// Read
function getUser() { }
function getUserById() { }
function findUserByEmail() { }
function fetchProducts() { }

// Update
function updateUser() { }
function modifyProduct() { }
function editOrder() { }

// Delete
function deleteUser() { }
function removeProduct() { }
function destroySession() { }
```

### Boolean 반환 함수
- **is**, **has**, **can**, **should** 접두사 사용

```javascript
// ✅ 좋은 예
function isValidEmail(email) { }
function hasPermission(user) { }
function canAccess(resource) { }
function shouldRefresh() { }

// ❌ 나쁜 예
function validEmail(email) { }
function checkPermission(user) { }
```

### 이벤트 핸들러 함수
- **handle**, **on** 접두사 사용

```javascript
// ✅ 좋은 예
function handleClick() { }
function handleSubmit() { }
function onUserLogin() { }
function onDataLoad() { }

// ❌ 나쁜 예
function click() { }
function submit() { }
```

***

## 클래스명 컨벤션

### 기본 규칙
- **PascalCase** 사용
- 명사 사용
- 클래스가 나타내는 개체나 개념을 명확히 표현

```javascript
// ✅ 좋은 예
class User { }
class ProductManager { }
class DatabaseConnection { }
class EmailService { }

// ❌ 나쁜 예
class user { }
class productmanager { }
class db_connection { }
```

### 특수 목적 클래스
```javascript
// Service 클래스
class UserService { }
class PaymentService { }

// Manager 클래스
class SessionManager { }
class CacheManager { }

// Helper/Utility 클래스
class DateHelper { }
class StringUtil { }

// Exception 클래스
class ValidationException { }
class NetworkError { }

// Controller 클래스 (웹 개발)
class UserController { }
class ProductController { }
```

***

## 상수명 컨벤션

### 기본 규칙
- **SCREAMING_SNAKE_CASE** 사용
- 모든 글자 대문자, 단어 구분은 언더스코어(_)

```javascript
// ✅ 좋은 예
const MAX_RETRY_COUNT = 3;
const API_BASE_URL = 'https://api.example.com';
const DEFAULT_PAGE_SIZE = 20;

// 설정값
const DATABASE_CONFIG = {
  HOST: 'localhost',
  PORT: 5432,
  MAX_CONNECTIONS: 100
};

// ❌ 나쁜 예
const maxRetryCount = 3;
const apiBaseUrl = 'https://api.example.com';
const default_page_size = 20;
```

### 열거형(Enum) 상수
```javascript
// ✅ 좋은 예
const USER_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  PENDING: 'pending',
  SUSPENDED: 'suspended'
};

const HTTP_STATUS_CODE = {
  OK: 200,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500
};
```

***

## 파일 및 폴더 컨벤션

### 파일명
- **kebab-case** 또는 **camelCase** 사용 (프로젝트 일관성 유지)
- 파일의 역할과 내용을 명확히 표현

```
// ✅ 좋은 예 (kebab-case)
user-service.js
product-manager.js
email-validator.js
api-client.js

// ✅ 좋은 예 (camelCase)
userService.js
productManager.js
emailValidator.js
apiClient.js

// ❌ 나쁜 예
UserService.js
user_service.js
userservice.js
```

### 폴더명
- **kebab-case** 사용
- 계층 구조를 명확히 표현

```
src/
├── components/
├── services/
├── utils/
├── api-clients/
├── test-fixtures/
└── user-management/
    ├── components/
    ├── services/
    └── types/
```

### 특수 파일
```
// 설정 파일
config.js
app-config.js
database-config.js

// 테스트 파일
user-service.test.js
user-service.spec.js

// 타입 정의 파일
user.types.js
api.types.js

// 인덱스 파일
index.js
```

***

## API 엔드포인트 컨벤션

### RESTful API
- **kebab-case** 사용
- 복수형 리소스명 사용
- HTTP 메소드와 URL의 의미가 일치해야 함

```
// ✅ 좋은 예
GET    /api/users
GET    /api/users/123
POST   /api/users
PUT    /api/users/123
DELETE /api/users/123

GET    /api/products
GET    /api/product-categories
POST   /api/user-orders

// ❌ 나쁜 예
GET    /api/getUsers
POST   /api/createUser
GET    /api/user_list
```

### 쿼리 파라미터
- **snake_case** 사용

```
// ✅ 좋은 예
/api/users?page_size=20&sort_by=created_at&order_by=desc

// ❌ 나쁜 예
/api/users?pageSize=20&sortBy=createdAt&orderBy=desc
```

***

## 데이터베이스 컨벤션

### 테이블명
- **snake_case** 사용
- 복수형 사용

```sql
-- ✅ 좋은 예
users
products
order_items
user_permissions

-- ❌ 나쁜 예
Users
user
orderItems
userPermission
```

### 컬럼명
- **snake_case** 사용
- 의미 명확한 이름 사용

```sql
-- ✅ 좋은 예
user_id
first_name
created_at
is_active

-- ❌ 나쁜 예
userId
fname
createdAt
active
```

### 인덱스명
```sql
-- ✅ 좋은 예
idx_users_email
idx_orders_created_at
uk_users_username  -- unique key

-- ❌ 나쁜 예
index1
users_idx
```

***

## 특수 상황별 가이드

### 약어 사용 가이드
```javascript
// ✅ 허용되는 약어
const id = 'user123';           // identifier
const url = 'https://...';      // uniform resource locator
const api = new ApiClient();    // application programming interface
const db = new Database();      // database
const config = {};             // configuration

// ✅ 잘 알려진 약어는 camelCase에서 첫 글자만 대문자
const userId = 'user123';
const apiKey = 'key123';
const htmlContent = '';
const jsonData = {};

// ❌ 지나친 약어 사용 피하기
const usr = {};  // user로 쓰기
const pwd = '';  // password로 쓰기
const addr = {}; // address로 쓰기
```

### 임시 변수
```javascript
// ✅ 좋은 예
const tempUser = {};
const cachedData = {};
const backupConfig = {};

// ❌ 나쁜 예
const temp = {};
const tmp = {};
const bak = {};
```

### 루프 변수
```javascript
// ✅ 좋은 예 (의미 있는 이름)
for (const user of users) { }
for (const product of products) { }

// ✅ 허용 (단순한 인덱스 루프)
for (let i = 0; i  {};

// ❌ 특수문자 (언더스코어, 달러 제외)
const user-name = 'john';  // 하이픈 금지
const user@name = 'john';  // @ 금지

// ❌ 오타가 포함된 이름
const lenght = 10;  // length 오타
const widht = 20;   // width 오타
```

### 혼동을 일으킬 수 있는 이름들
```javascript
// ❌ 피해야 할 이름들
const data = {};      // 너무 일반적
const info = {};      // 너무 일반적
const item = {};      // 너무 일반적
const thing = {};     // 의미 없음
const stuff = {};     // 의미 없음
const obj = {};       // 너무 일반적
const val = {};       // value로 쓰기
const num = 0;        // number로 쓰기
```

***
