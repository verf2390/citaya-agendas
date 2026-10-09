// The explicit policy and mandatory website type are independent of brief parsing.
export function mediaFirstEnabled(config) {
  return config?.mediaPolicy?.mediaFirst === true || config?.videoType === 'website_showcase';
}

export function mediaFirstPolicy(config, selected) {
  return {
    ...config?.mediaPolicy,
    mediaFirst: selected === true || config?.videoType === 'website_showcase',
  };
}
