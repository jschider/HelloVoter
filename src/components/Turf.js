import React, { Component } from 'react';

import { jwt } from '../config.js';

export default class App extends Component {

  constructor(props) {
    super(props);

    this.state = {
      loading: true,
    };

  }

  componentDidMount = async () => {
    let turf = {};

    try {
      let res = await fetch('https://'+this.props.server+'/canvass/v1/turf/list', {
        headers: {
          'Authorization': 'Bearer '+(jwt?jwt:"of the one ring"),
          'Content-Type': 'application/json',
        },
      });
      turf = await res.json();
    } catch (e) {
      console.warn(e);
    }

    this.setState({loading: false, turf: turf.data});
  }

  render() {
    return (
      <div>
        {(this.state.loading?'loading':this.state.turf.map(t => <Turf key={t.id} turf={t} />))}
      </div>);
  }
}

const Turf = (props) => (
  <div>
    Name: {props.turf.name} <br />
  <hr />
  </div>
)

