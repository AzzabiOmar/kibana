/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */



import expect from 'expect.js';
import { validateModelMemoryLimit } from '../validate_model_memory_limit';

describe('ML - validateModelMemoryLimit', () => {


  // mock info endpoint response
  const mlInfoResponse = {
    defaults: {
      anomaly_detectors: {
        model_memory_limit: '1gb',
        categorization_examples_limit: 4,
        model_snapshot_retention_days: 1
      },
      datafeeds: {
        scroll_size: 1000
      }
    },
    limits: {
      max_model_memory_limit: '20mb'
    }
  };

  // mock cardinality search response
  const cardinalitySearchResponse = {
    took: 8,
    timed_out: false,
    _shards: {
      total: 15,
      successful: 15,
      skipped: 0,
      failed: 0
    },
    hits: {
      total: 1793481,
      max_score: 0,
      hits: []
    },
    aggregations: {
      instance: {
        value: 77
      }
    }
  };

  // mock callWithRequest
  // used in two places:
  // - to retrieve the info endpoint
  // - to search for cardinality of split field
  function callWithRequest(call) {
    if (typeof call === undefined) {
      return Promise.reject();
    }

    let response = {};
    if (call === 'ml.info') {
      response = mlInfoResponse;
    } else if(call === 'search') {
      response = cardinalitySearchResponse;
    }
    return Promise.resolve(response);
  }

  function getJobConfig(influencers = [], detectors = []) {
    return {
      analysis_config: { detectors, influencers },
      data_description: { time_field: '@timestamp' },
      datafeed_config: {
        indices: []
      },
      analysis_limits: {
        model_memory_limit: '20mb'
      }
    };
  }

  // create a specified number of mock detectors
  function createDetectors(numberOfDetectors) {
    const dtrs = [];
    for (let i = 0; i < numberOfDetectors; i++) {
      dtrs.push({
        function: 'mean',
        field_name: `foo${i}`,
        partition_field_name: 'instance'
      });
    }
    return dtrs;
  }

  // tests
  it('Called with no duration or split and mml within limit', () => {
    const job = getJobConfig();
    const duration = undefined;

    return validateModelMemoryLimit(callWithRequest, job, duration).then(
      (messages) => {
        const ids = messages.map(m => m.id);
        expect(ids).to.eql([]);
      }
    );
  });

  it('Called with no duration or split and mml above limit', () => {
    const job = getJobConfig();
    const duration = undefined;
    job.analysis_limits.model_memory_limit = '21mb';

    return validateModelMemoryLimit(callWithRequest, job, duration).then(
      (messages) => {
        const ids = messages.map(m => m.id);
        expect(ids).to.eql(['mml_greater_than_max_mml']);
      }
    );
  });

  it('Called large number of detectors, causing estimated mml to be over the max', () => {
    const dtrs = createDetectors(10);
    const job = getJobConfig(['instance'], dtrs);
    const duration = { start: 0, end: 1 };
    job.analysis_limits.model_memory_limit = '20mb';

    return validateModelMemoryLimit(callWithRequest, job, duration).then(
      (messages) => {
        const ids = messages.map(m => m.id);
        expect(ids).to.eql(['estimated_mml_greater_than_max_mml']);
      }
    );
  });

  it('Called with small number of detectors, so estimated mml is under max', () => {
    const dtrs = createDetectors(2);
    const job = getJobConfig(['instance'], dtrs);
    const duration = { start: 0, end: 1 };
    job.analysis_limits.model_memory_limit = '20mb';

    return validateModelMemoryLimit(callWithRequest, job, duration).then(
      (messages) => {
        const ids = messages.map(m => m.id);
        expect(ids).to.eql(['success_mml']);
      }
    );
  });

  it('Called enough detectors to cause estimated mml to be over specified mml', () => {
    const dtrs = createDetectors(2);
    const job = getJobConfig(['instance'], dtrs);
    const duration = { start: 0, end: 1 };
    job.analysis_limits.model_memory_limit = '10mb';

    return validateModelMemoryLimit(callWithRequest, job, duration).then(
      (messages) => {
        const ids = messages.map(m => m.id);
        expect(ids).to.eql(['estimated_mml_greater_than_mml']);
      }
    );
  });

  it('Called with enough detectors to cause estimated mml to be over specified mml, no max setting', () => {
    const dtrs = createDetectors(2);
    const job = getJobConfig(['instance'], dtrs);
    const duration = { start: 0, end: 1 };
    delete mlInfoResponse.limits.max_model_memory_limit;
    job.analysis_limits.model_memory_limit = '10mb';

    return validateModelMemoryLimit(callWithRequest, job, duration).then(
      (messages) => {
        const ids = messages.map(m => m.id);
        expect(ids).to.eql(['estimated_mml_greater_than_mml']);
      }
    );
  });

  it('Called with small number of detectors, so estimated mml is under specified mml, no max setting', () => {
    const dtrs = createDetectors(1);
    const job = getJobConfig(['instance'], dtrs);
    const duration = { start: 0, end: 1 };
    job.analysis_limits.model_memory_limit = '20mb';

    return validateModelMemoryLimit(callWithRequest, job, duration).then(
      (messages) => {
        const ids = messages.map(m => m.id);
        expect(ids).to.eql(['success_mml']);
      }
    );
  });

  it('Called with specified invalid mml of "0mb"', () => {
    const dtrs = createDetectors(1);
    const job = getJobConfig(['instance'], dtrs);
    const duration = { start: 0, end: 1 };
    job.analysis_limits.model_memory_limit = '0mb';

    return validateModelMemoryLimit(callWithRequest, job, duration).then(
      (messages) => {
        const ids = messages.map(m => m.id);
        expect(ids).to.eql(['mml_value_invalid']);
      }
    );
  });

  it('Called with specified invalid mml of "asdf"', () => {
    const dtrs = createDetectors(1);
    const job = getJobConfig(['instance'], dtrs);
    const duration = { start: 0, end: 1 };
    job.analysis_limits.model_memory_limit = 'asdf';

    return validateModelMemoryLimit(callWithRequest, job, duration).then(
      (messages) => {
        const ids = messages.map(m => m.id);
        expect(ids).to.eql(['mml_value_invalid']);
      }
    );
  });

});
