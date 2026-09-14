---
summary: "V1: Verbatim agent-design requests supplied by the user."
read_when:
  - Discussing agent capabilities, orchestration, memory, or automation requirements
---

# V1 - Agentic startup - original requests

Received September 13, 2026. Source wording follows unchanged, including transcription errors, whitespace, and unresolved alternatives. This is a source record, not an instruction to implement every proposal or replace current repository instructions. See [product-direction.v1.md](product-direction.v1.md) for separately labeled recommendations and [accepted decisions](adr/0002-preserve-original-requests.v1.md) for the preservation rule.

## Original wording

````text
make the agents as good as possible reference
  opensrc reference your skills etc test and verify
  it,  Yeah, so pretty much what it should do is
  that there should be a master worker agent or
  architecturezzz For example, I want you to make
  sure that I kinda like the UI. I mean, some of
  this stuff might be outdated, but I want you to
  make sure, like, we could do pretty much
  everything. Like, um, make it very catered towards
  if we merge to AviMark later on. Make it, like,
  very... Make sure, uh, um, Amplify make sure that
  it can use that and it can literally see like real
  businesses and they make a button to where they
  can dynamically change the price like really use
  the Google ADK you know make sure it's like
  working everything like you have all the keys and
  stuff. Make sure like it's pretty similar to like
  how we would if we got into like when we got
  integration from like Abumarik or Cornerstone it
  would be very smooth to like you know switch to
  real data make it that's the main goal right. So
  basically make these agents as good as possible
  for example the internal agent right that one
  should be I don't really mess up the UI like I'm
  working on the UI on the side Actually, you could
  you could work a little bit the UI for example,
  but keep in mind like Yeah, so basically Like work
  a little bit of the UI like not like basically not
  much in the UI I don't want you worried too much
  about that. We worry about the Google ADK agents
  Also, I want you to switch to a master worker
  pattern so how this one would work is you have a
  master agent Then it could like split up into like
  separate agents. For example, like let's talk
  about the internal agent, right? this one should
  For example if it's a So like for example, like a
  sub-basin you could do is a, like for example,
  let's say internal agent, right? Like let's say
  like a admin, they're like, hey, uh, like for
  example, this would be very easy. Right? You could
  do exactly that. Right? You could do exactly that.
  they even can use it on their phone right on the
  go like maybe we could have some kind of like like
  a website which is very mobile friendly and Then
  they can even do this prompt on the go, right? So
  If you make sure it's gonna work right because I
  don't really know if it works right now, I mean
  yeah, so basically the Internal agent. Yeah, it
  should have like a master worker pattern Master
  agent can direct it maybe a good cheap or it's
  maybe probably some cheap LLM just like a router
  like extremely cheap right, and they can route to
  like a Remember, we're very cost sensitive to But
  should like, you know, properly choose like the
  right LLM And Yeah, so there'll be a cheap LLM
  which is like the master agent it could pretty
  much just route properly, maybe parse in the
  request and give the parse output to the to the
  other agents so some other agents for example is
  going to be one like you know it could like manage
  internal data this agent would basically be a kind
  of like a maybe a slightly more powerful model you
  know appropriately size the model like cheap is
  important you could also use my open router API
  key I think that somewhere in my ZHRC. Anyways...
  Internal agent. Yeah, it should have a master-
  worker pattern. The master agent can direct it to
  a cheap LLM, probably some cheap LLM, just like a
  router, extremely cheap, right, and they can route
  to... Remember, we're very cost-sensitive, but
  should properly choose the right LLM. So there'll
  be a cheap LLM, which is like the... And then I
  was thinking that this would be the master agent,
  that would be like, you know, the tool calling
  agent. Then there would be a Appointment booking
  agents appointment booking agent. This one would
  be a plant and execute because you know actually
  I'm just thinking about it maybe like the don't
  make the master agent isn't too cheap. I just
  realize so basically the first agent right this
  one would be plan an execute agent the reason is
  is because we need Yes, I like the booking agent
  that'll be pretty clear because all you need to do
  is like it's pretty fine right you're just taking
  the steps the steps would be like use our
  integration somehow and then just like book an
  appointment to be honest so use that model so
  that's gonna be the booking agentthen we would
  have a conversation agent which is just a tool
  loop. We could use rag to store information on
  this person right because they're all logged in
  like a unique session so we'd probably like do rag
  open AI and beddings and then Yeah, decide what's
  the best approach but the best approach is the
  same thing that Claud uses so it's gonna be 0.7
  times the similarity school score which we used to
  with cosine similarity +.3 times Bm 25 Or
  something similar just so that we can make sure
  that we retrieve is similar based on the vector
  similarity and also like text matching so I'm
  pretty sure that's just what I use anyway like
  that should not be modifiable because we wanna
  make it like as simple for the person to do like
  all you need to do is chat and we have all
  informationso that's gonna be the conversation
  agent. It's gonna be a loop you know it's gonna be
  like you know first step it's gonna take the input
  second step is gonna retrieve information on the
  user when restore stuff like at the end of the
  conversation agent how we actually store is we're
  gonna have the agget a put in key features of
  conversation if it thinks it's relevant for
  example like it would get features that's easier
  to embed for example like like concise or things
  like that right obviously let the person be able
  to update this like maybe they can remove it if
  they think so, but it should not it should be very
  simple. Like, maybe we don't even need to rdon't
  take things like hey I'm feeling very concerned
  right or something like that because the problem
  is that that's a very temporary emotion so we need
  to make sure that when we restore we have this
  conversation it stores in the right way and then
  yeah pretty much a response so it doesn't really
  have any. Let me think with action it so actually,
  the action is a look at the decisions we did for
  example you could look at the if you booked an
  appointment, maybe get something temporary like
  retrieval time that would store like the most
  recent decisions you know along with the user ID
  and stuff so we can put that in post or some kind
  of sequel light even a database so that we were
  able toquickly check like by the user ID like is
  there anything relevant just a sequel decision
  made if there's anything relevant so that action
  has the agent has some other agent in the internal
  agent would be compare with other businesses
  agents so just plan an execute cause we already
  know what to do. It's gonna take the input very
  simple input. We were just like use theto see
  other businesses and how this one should work
  actually it should also be like a job as well like
  we could also like we could have an 😼😼 bring up
  like every month like end of the month. It could
  send emails to all of our customers. Okay, so
  basically, just to summarize, we have a master
  agent. This was going to be some decently sized
  model. This one is going to be like a tool calling
  agent. It is going to take in the input, parse it,
  send it to the relevant agent, return the output,
  and get from the tool.

  There is also, at the very start, this should be a
  cache. At the very start of the master agent, this
  cache works by the master agent itself doing the
  caching. The relevant term is that if the same guy
  keeps asking about the same thing, there should be
  a cache. Of course, make the time to live kind of
  short, to be honest. It depends on what it is
  actually for. For example, if it is just going to
  be an appointment, there should be separate
  things. The book appointment one I saw, I get to
  that later.

  Basically, it is just storing things like if the
  person keeps asking within the first three
  minutes, like, "Hey, when is this guy booked?" or
  the first minute or something. Make the time to
  live very, very short, to be honest, because they
  could change the appointment time as well.
  Actually, don't we mention that? My bad, that is
  for the wrong agent. For the internal agent, they
  won't even book appointments. My bad, that is a
  different agent that does that.

  Okay, so let me just summarize everything. We have
  a master agent. It should cache some stuff, like
  if the guy keeps saying, "Hi to test it out." We
  just cache that "hi." We don't need to send that
  to the larger conversation agent. Cache some stuff
  like that. I could have slipped up, actually, so
  we'd have the master agent. This was going to be a
  medium-sized agent. This one would have a cache,
  then.
Okay so here's the plan actually okay so Okay, so we want to make this as simple as possible okay, so first step you have an internal agent, okay So this one goes to the admin right and To this one should do a lot of things, right So with the very first step right when they put in the input there should be some kind of guardrail right so like they can't ask for like if like immediately like at some PII detector sentiment classifier something like a very small sentiment model or even retake scanning it should never like no matter what even for like admin it should never like say actually no admin has all the permissions that's fine but we should have this one for the external agent okay so that so that without guardrails would be at the external agent so let me just break it down right so for the first step for the internal agent this would be a master worker agent so how this one works is that there would be a master agent then there would be master agent it could do things like taking the input and parsing it so you're taking a prompt it would just parse it and then it could the actions it has is it could talk call the different sub different worker agents it has right it'll just redirect it right should be just got medium-size take me inside this internal agent there would be a cache this cache would for example the person keeps saying hi we don't need to waste tokens we just kind of return that so the master agent once it's done with tickets that gets back the tool call or gets back the input from the worker agent and it could optionally cash something if it thinks like if it's very like common right or if it thinks like it could be cached like we're not going to cash in random stuff like like things that change a lot for example like we don't want to cash in like hey we sent out a thousand emails because you know the problem with that is that we that would be an issue because the time to live might be incorrect right they might change something so time to live might be incorrect but if it's like a basically high or something or whatever um we can just cash that right the cash isn't is gonna be something here not too much for that internal agent i don't think you can do too much and then the architecture itself would be a tool called would be a tool calling agent so that'll be it we move on to the second step which is the sending email agent this one is going to be a plan and execute agent because we already know the steps first step is this one is actually like going to be very sensitive right because this is gonna be literally could send out thousand emails right so the first step is to first of all verify like hey is this what you actually want to be doing send our emails second step is And by the way it would put all this at the same time right because people hate the endless like endless conversation So you though it would ask all the questions at the same time right it wouldn't go it would not go step by step right, so Second step I do is your link to a Link to Email editing page, right? So it will link to the ui in our internal in our admin ui the editing email template right and The person literally needs to look at it right I mean we would have a Defined email Like they are but they wouldn't have to look at it like right because that's pretty important So that's like a must they need to click on that Third thing is The size of the people so it would so first option would be like on Send out all the emails right now Right Then yeah so that would be the plan execute model Retrieve Nothing really nothing to retrieve really to be honest It's just a tool called And then reasoning it'll do the plan execute do the three-step plan Then fourth step action fifth step storage so it would store this decision for example in a sql Database because we destroyed. Okay User decision it would contain the time stamp containing the user ID because you know We could just equal query that later the user ID if they want to check Hey did we send it out and we just check the decisions and yes, we just say yes restore that information, right? Because we need to store this information. Otherwise, there was a state list lm call because we need to state story information on this guy Right time to live can be like, you know a Year or something Of course the rule keep track that timestamp And also the lm would keep track of the current date, right? That should be provided. This is like it should already know that Yeah Also, one other thing I want to mention is that for our system prompts this is gonna be very you know Specialized it's gonna have a persona the output should It's gonna put in Like guardrails For internal agents, they shouldn't be too many guardrails though to be honest There'd be in context learning like examples of what exactly to output things like that, right? So let me default for all the prompts So then that would be that for the email one one other thing is that With this one would actually called later on so I want this one to be called when The person Is So we could have something in the UI it should default off There should be a tab in the UI like edit email right? It look email send out right and so Every time we wanted to like send an email It could actually use these steps Because we only reuse code After the appointment also we could also use this send out email agent Which So like there'll be two settings we could switch on and off The first setting would be A monthly Like you kind of like a kind of like a cold email like something like hey love to see your pet and It would take only the last People you know just like hey you don't want to make sure that you're doing well Like something that that was actually like would not be like we're selling something But like hey you know we wanna make sure you do okay things like that right But almost like uh Something like with a trust us like hey you know we want it sent out our pet to you again right And then the second step would be Seven days after the initial appointments, for example, we could use like a kafka Store and I you know appointment done things like that this would be kind of later on to be honest but you can kind of walk it out first and it would contain things like appointment done and then so we go kafka and then yeah and kafka so then let's go so then now we're going to this to the after appointment done so like appointment is done right this can go to a kafka which is like a queue you know it hit our broker topics uh let me think how it works so topic would be appointment done the then this would point to the consumer group which are just a bunch of consumers we have which will just be uh you know sending like email and by the way like we do so many operations i don't kafka takes in like 10k it takes in like literally a million rights per second right so it's ridiculous per yeah so it's actually ridiculous per broker so yeah i mean we don't have to wait we don't have to scale too much about this because it will definitely be way under that like even if we scale us like you know literally hundreds of people hundreds of veterinarians he will put that in one broker um yeah so then they'll go to a topic consumer group would pick that up the consumers are gonna be just sending out an email to them we can also just do yeah i know we keep on picking it up it was sent out all the emails maybe like batch emailing even once it reaches a certain size or after a certain time you can set up the emails this also would be another consumer that pick this up would be the analytics so we'd have another consumer group that would pick this one up and it would do analytics on it eventually like hey how many appointments came in they kind of business things right like if corner store has integration like okay how much business how much came in how much what's your profit right do analytics on that and then yeah so that's how we kind of look also just to keep in mind right a very important thing is that we're gonna scale this up to be like you know a slack has likes black dot scale enterprise comm or slack dot door dash dot enterprise calm so we want to scale up to that right so like you know instead of just one in claim doing this it would be like multiple I could use this right they would be able to log in and things like that great so that would be the main goal skill it up read eventually use like ECS potentially put the manager agents in there put the right so put put the manager agent in a pod or like ECS how it works so you put that major easy in a pod have a group of 20 you know do auto scaling there put the separate agents in like separate pods you could scale those up to That's how it kind of look like Okay, anyway, so yeah, so now basically two buttons right and they would configure like the separate emails like that one email for the I One email for the One email template for like, you know at the end of the month and then one email template for the After appointment like make you configure how many days? It should be very simplistic for the user to be able to do that And both of them we should use this like appointment agent I'm sorry. It's not not appointment. It should use the Email agent like every time they try to change something there it would use the same three steps, right? Are you sure? second is gonna be they have to click the thing verify it third thing is like You know configure frequency and put all the questions at the same time, right? So it's easy to answer and they have to get like pretty much all the things Even probably to make sure that they actually go through it. Just like hey, yeah, I edited it or like hey, I Went through it or like I reviewed it. You know you don't have to edit it. Like I reviewed it I agree. I reviewed it and third thing is gonna be like how many days? Fourth thing is gonna be There's three things and Like a default there's three things right and like say like include a default is gonna be like after seven days they can edit that in the chat to Using the email agent So that's give me the one agent So the second agent in the internal one is going to be Compare prices agent, so this is also going to be something we could toggle But how this one would look like is that And so this second one is going to be a compare prices one. This one's just going to be literally plan to execute as well, but it's just going to be literally our API, whatever we do to compare the prices of other people and this one. Let's see, plan execute.

First step is going to be, okay, your current default is going, so you know, kind of group messages again. First thing you would do is that it would say, "These are the settings. Let me know if you want me to change it." The second thing is to put it all in one message, because we don't want an endless conversation. And then, in the settings that contain location, whatever we put in there, right? Company, whatever we do for the search, right?

The second thing is: I'm going to send out, and then actually, no, it wouldn't ask for any questions here, because, to be honest, it was just like: look at this one, hey, these are your current ones, and then it would just send it out. Do some slight weight limiting gear, right? They can't just spam it. I mean, you know, that's something way like, actually, maybe really been like: you can do ten in like five minutes or something, because sometimes they did the wrong search or something, right? I mean, I highly doubt they're going to spend it, but yeah, so that'd be the second agent, Story your store, that stores the decisions, with a very short time to live, because it would change a lot.

By the way, for the second agent, this agent, where does it do this one? It could dynamically change the prices of the business, right, so it's actually actionable. For example, they're also using some reasoning here, think very deeply. It'll also retrieve information on the person, with information on the user, right? I'll restore that later on. This would be stored in a rag, yeah. 




So yeah, it would just dynamically change the price. We want this to be very accurate. Later on, we can use some debate module, some ensemble type thing, but for now let's just keep it. Let's just use it, and then we could consider doing that. I think maybe one should be okay. We don't use too many credits, but yeah, it was really the best model for this one.

Who would think a lot, take information, decide, "Hey, should we increase prices?" If it does, then you would increase prices. It would actually talk to them, research on that, and then you would say, "I think you'd be in an auto mode." The person can automatically, yes, you could always do this one automatically, change the prices so you're matched with the person's information, and it's not going to be always just lower automatically. Also manage information on the user, and they also just say, "Okay, this is what we're considering lowering." Put it in a very easy, simple way, and also allow an automatic mode.

This one should also be a tab. It should be a tab there. This tab should be, "Are you sure you want to make it automatic?" The first thing is going to be the pricing agent. The third agent is going to be the conversation agent. Again, it's going to retrieve information on the user. Also, for the second agent, I forgot, but for the pricing agent, it should also store information on the user, like if it kind of decides to approve it or not approve it. Also store decisions in two places, one in, I think, Postgres with PG vectors, which is good enough. Store kind of free text, like yeah, we have that thing, also get feature vectors here, import features.

The third thing is the conversation agent. This one's just going to be a tool calling agent. It's going to first retrieve information, it's going to respond, and if the user likes it, we would use OpenAI embeddings actions. It can look at the vector database, look at the user ID, and make quick decisions. You'll get to store information on the user, and then all the information goes back to the internal agent to decide, "Okay, I'm going to return that back properly." That's how that agent looks, so they would also be another worker agent. I haven't seen it before, but pretty much how this would work is that it would be two separate booking agents. This one would be an internal one, so it would not charge anything for them. Booking one would be like you put in information, things like that. You put in a space and the time and date, and if it doesn't get all the required ones, they would ask me. Actually, not even being L11, but yeah, this is actually the book. You can also add or delete or change anything.

That's how this one would work. Pushman stores, like, "Hey, who did that, who did what?" I have guardrails and stuff because we don't want them to delete. Deleting should be kind of hard, to be honest. Guardrails for everyone deleting and changing stuff should be kind of rare. Adding is okay, but that should make a free one. Also put in a disclaimer, like, "Hey, I recommend you having them do it on the extra, unlike that other chat on their own login," because otherwise there'll be kind of an issue here.

That would be that one, and then for the external agent, this will contain information on the customers themselves. The extra agent is going to be a master worker pattern, and the same thing with the master agent, right? Pretty much the same dynamics, caching tool calling whatever, same size. Booking agent would be plan to execute. First step, it would not be an infinite one, right? It would just be the first one, which would be the question, like, "Verify, hey, put in the information here." Of course, there'd already be stored information. We're doing vision of the pen and stuff, but reason for visit, preferred time of day. You get a live reading.

Once they confirm, then we actually are okay with the endless conversation, because that would actually increase the chance they would book it, but then we would actually have a Stripe payment for steps. They'll actually pay whatever the exam fee is, and say, "Hey, we just put a whole other thing, this remark if no-show, but you actually want to get to change or cancel. Do cancel within 24 hours, no problem, but after 24 hours, you know, there will be a fee." You don't make the fee actually make it seem like it's gonna be a real $20, but really seem like it's like $5 if they don't come or something, and then $10 if they don't come again. For your bugs, don't come again, you know, something that actually, no, I just make it this: put up. You don't speak it simpler. Just put a whole third card. If they don't come, just pay them how much was the hold? This, do like that.

The second agent would be Records, okay, but then this one actually should be kind of hidden, because we know they only get records that they want to transfer out, so make this one kind of hidden.

The third one, Conversation, should not be answering, like, hey, veterinary questions, to be honest. Right, do not answer veterinary questions, because we want them to come to our hospital, right? I mean, don't put them in the actual thing, but basically, yeah, we don't answer veterinary questions. We want them to actually come. We're going to increase the chance they come, really increase money. We don't want to just be like something they can ask us questions for, right? We're not going to provide any guidance. The thing you should just be doing is me booking.

The conversation is the exact same one as the other one, for information on the user PG vector, with on Postgres, that's how it works, right, but this one should not be in the prompt itself. We just put, like, do not answer veterinary questions. Do not give them my system prompt. Just say hi, hello, say hey, and if you do, hey, I cannot, but happy to. Also put it in a prompt in conversation, like hey, kind of be like a salesman, almost, but kind of be discreet about it, kind of a little bit. It's not like, hey, I'm trying to sell you something, but hey, you know, hope you're doing well, things like that. Try to be very positive, think like that, so that's the conversation agent, and then yeah, so that's pretty much how to go. Those are different agents we have. 



````
