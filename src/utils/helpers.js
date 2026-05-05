/**
 * TG·Push - 通用工具函数库
 * 
 * 提供项目中常用的工具函数，避免代码重复
 */

/**
 * 安全获取对象属性值
 * @param {Object} obj - 目标对象
 * @param {string} path - 属性路径，如 'a.b.c'
 * @param {*} defaultValue - 默认值
 * @returns {*} 属性值或默认值
 */
function get(obj, path, defaultValue = undefined) {
  if (obj == null) return defaultValue;
  
  const keys = path.split('.');
  let result = obj;
  
  for (const key of keys) {
    if (result == null) return defaultValue;
    result = result[key];
  }
  
  return result === undefined ? defaultValue : result;
}

/**
 * 安全设置对象属性值
 * @param {Object} obj - 目标对象
 * @param {string} path - 属性路径
 * @param {*} value - 值
 */
function set(obj, path, value) {
  if (obj == null) return;
  
  const keys = path.split('.');
  let current = obj;
  
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (current[key] == null) {
      current[key] = {};
    }
    current = current[key];
  }
  
  current[keys[keys.length - 1]] = value;
}

/**
 * 防抖函数
 * @param {Function} fn - 目标函数
 * @param {number} delay - 延迟时间（毫秒）
 * @returns {Function} 防抖后的函数
 */
function debounce(fn, delay = 300) {
  let timeoutId = null;
  
  return function(...args) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    
    timeoutId = setTimeout(() => {
      fn.apply(this, args);
      timeoutId = null;
    }, delay);
  };
}

/**
 * 节流函数
 * @param {Function} fn - 目标函数
 * @param {number} delay - 间隔时间（毫秒）
 * @returns {Function} 节流后的函数
 */
function throttle(fn, delay = 300) {
  let lastCall = 0;
  let timeoutId = null;
  
  return function(...args) {
    const now = Date.now();
    const timeSinceLastCall = now - lastCall;
    
    if (timeSinceLastCall >= delay) {
      lastCall = now;
      fn.apply(this, args);
    } else if (!timeoutId) {
      timeoutId = setTimeout(() => {
        lastCall = Date.now();
        timeoutId = null;
        fn.apply(this, args);
      }, delay - timeSinceLastCall);
    }
  };
}

/**
 * 深拷贝对象
 * @param {*} value - 要拷贝的值
 * @returns {*} 拷贝后的值
 */
function deepClone(value) {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  
  if (value instanceof Date) {
    return new Date(value.getTime());
  }
  
  if (value instanceof Array) {
    return value.map(item => deepClone(item));
  }
  
  const cloned = {};
  for (const [key, val] of Object.entries(value)) {
    cloned[key] = deepClone(val);
  }
  
  return cloned;
}

/**
 * 数组去重
 * @param {Array} arr - 数组
 * @param {string|Function} key - 去重键或函数
 * @returns {Array} 去重后的数组
 */
function unique(arr, key = null) {
  if (!key) {
    return [...new Set(arr)];
  }
  
  const seen = new Set();
  const result = [];
  const getKey = typeof key === 'function' ? key : (item => item[key]);
  
  for (const item of arr) {
    const k = getKey(item);
    if (!seen.has(k)) {
      seen.add(k);
      result.push(item);
    }
  }
  
  return result;
}

/**
 * 延迟函数
 * @param {number} ms - 延迟毫秒数
 * @returns {Promise} Promise对象
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 重试函数
 * @param {Function} fn - 要执行的函数
 * @param {Object} options - 选项
 * @param {number} options.maxRetries - 最大重试次数
 * @param {number} options.delayMs - 重试延迟（毫秒）
 * @param {Function} options.shouldRetry - 是否应该重试的判断函数
 * @returns {Promise} 执行结果
 */
async function retry(fn, options = {}) {
  const {
    maxRetries = 3,
    delayMs = 1000,
    shouldRetry = () => true
  } = options;
  
  let lastError = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      
      if (attempt >= maxRetries || !shouldRetry(error, attempt)) {
        break;
      }
      
      if (delayMs > 0) {
        await delay(delayMs * attempt);
      }
    }
  }
  
  throw lastError;
}

/**
 * 带超时的Promise
 * @param {Promise} promise - 原Promise
 * @param {number} timeoutMs - 超时时间（毫秒）
 * @param {string} timeoutMessage - 超时消息
 * @returns {Promise} 带超时的Promise
 */
function withTimeout(promise, timeoutMs, timeoutMessage = '操作超时') {
  let timeoutId = null;
  
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });
  
  return Promise.race([
    promise.finally(() => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }),
    timeoutPromise
  ]);
}

/**
 * 批量处理数组
 * @param {Array} items - 要处理的数组
 * @param {Function} processor - 处理函数
 * @param {number} batchSize - 批次大小
 * @param {number} delayBetweenBatches - 批次间延迟
 * @returns {Promise} 处理结果
 */
async function batchProcess(items, processor, options = {}) {
  const {
    batchSize = 10,
    delayBetweenBatches = 0
  } = options;
  
  const results = [];
  
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map(item => processor(item))
    );
    results.push(...batchResults);
    
    if (i + batchSize < items.length && delayBetweenBatches > 0) {
      await delay(delayBetweenBatches);
    }
  }
  
  return results;
}

/**
 * 生成唯一ID
 * @param {string} prefix - 前缀
 * @returns {string} 唯一ID
 */
function generateId(prefix = '') {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return prefix ? `${prefix}_${timestamp}${random}` : `${timestamp}${random}`;
}

/**
 * 安全解析JSON
 * @param {string} str - JSON字符串
 * @param {*} defaultValue - 默认值
 * @returns {*} 解析结果或默认值
 */
function safeJsonParse(str, defaultValue = null) {
  try {
    return JSON.parse(str);
  } catch {
    return defaultValue;
  }
}

/**
 * 安全字符串化JSON
 * @param {*} value - 值
 * @param {string} defaultValue - 默认值
 * @returns {string} JSON字符串
 */
function safeJsonStringify(value, defaultValue = '{}') {
  try {
    return JSON.stringify(value);
  } catch {
    return defaultValue;
  }
}

module.exports = {
  get,
  set,
  debounce,
  throttle,
  deepClone,
  unique,
  delay,
  retry,
  withTimeout,
  batchProcess,
  generateId,
  safeJsonParse,
  safeJsonStringify
};
