---
summary: "V1: Verbatim product and clinic-workflow requests supplied by the user."
read_when:
  - Discussing the overall product goal, clinic lifecycle, roles, or design direction
---

# V1 - Project goals - original requests

Received September 13, 2026. Source wording follows unchanged, including transcription errors, whitespace, and unresolved alternatives. This is a source record, not an instruction to implement every proposal or replace current repository instructions. See [product-direction.v1.md](product-direction.v1.md) for separately labeled recommendations and [accepted decisions](adr/0002-preserve-original-requests.v1.md) for the preservation rule.

## Original wording

````text



Use lavish and identify the best approach from here. discuss with me use diagrams etc and we can maek a plan to accomplish this one then after the lavish ois done then make a PRD from it and then we can implement that. 
Okay, don't worry about the UI right now. I want you to use lavish because I'm going to have another designer work on that, but pretty much we need to kind of align ourselves to match this. We want to focus on being agentic-first company.  the only reason we're doing this is because it's best for the customer. That's the main goal

For example, when they open their thing, it should just be the chat, and it should be things like, "Okay, this is what you could do, this is what you could do." That should be the main interface for everything. It could be able to do all the actions for that one and everything. 

Alright, here's the repo. The central goal is that we're trying to make a multi-tenant B2B SaaS. What does this mean? Most of them should have a lot of common elements. We can't make everything completely unique, right? A lot of them should have pretty common elements because we try to focus a lot on that, so we can't really be truly unique, but many people only need that.

The goal is to be as easy to use and as simple to understand as possible. That's the main goal: to make it as simple to use as possible. We need to make a design system now. Kind of follow with that.

What's the second thing? I think the main thing is to keep it as simple as possible. The second thing is we need to focus on the customer. The customer is veterinarians, so let's work backwards. What do veterinarians need?
1. Operations: they have no clue. They're very non-technical people who are now in charge of a business. What are some operations that are lacking?
2. Check-ins: when there's no business like that, the overall thing is the customer lifecycle. Before they come in, they should get an email or text: what exactly is going on? When they come in, they should be able to scan in an arrival form. While they're coming, they could be like, "Here's a payment using Stripe." After they can get a notification like, "Hey, how's your pet doing?" If any thumbs down, we can escalate. We could add it as a task to a human, take the comments, and add it as an issue, which can be added to a human operator. You'll get a call back from a human at that point, and this would be kind of escalated.
3. Easy-to-follow agents: agents are everything, so we should basically set up an open cloth for them. When they were like two emails, it would do calls. It would do everything: emails, calls, booking appointments. It should do things like creating accounts. This is wacky for that, sound like that, because I've been offended. They need to work backwards. They need receptionists, right? What's the second thing they need? That's not checking in. Moving it's kind of hard to do. It's kind of like a manual type of thing, but I think that moving to a room thing is more manual. I think that's a slight thing, a very small thing, so we can design you like that.
4. A task manager, because it needs to be very, very clear.
5. Very clear client status.
 For example, all of the receptions should see: "Okay, this is the client's current status. These are all the people that are currently here, and we don't need to overwhelm them. It should not be overwhelming. It should be very, very underwhelming because we think one step at a time. We want to make it as nice for them as possible because there would be a lot of clients. We do not want to overwhelm them. Just focus on what they need to do. All that could be toggled, but they should still get that information."

For example, this patient is something that should be kind of hidden a little bit further away. For example:
- Some patient is overnight.
- What step were they on?
- They checked in.
- Are they waiting to be moved to a room?
- What exactly are they waiting for?


Let's talk about the different phases:
- Post-check-in: moving into a room.
- Waiting: checking into a room.


Check-in, I think, has a bunch of information. Go high level first. This should be check-in, then the next step is going to be the one I just go one by one. Check-ins go on, and inside check-in, there would be things like all the questions. I think there is a very specific list of questions inside the actual code. There are a bunch of questions that are typical, like conditions and things like that. It goes into more detail there. It's not top-notch memory, but inside the code, it should be there: the different types of questions. I think I nailed that. It might need some small edits there, and of course, this should be very, very easy. It should be very engaging, and we could just do this to show that convincingly. Not that much more, unfortunately. You could even make it a good form, to be honest, just very customer-centric.

Now they're like, "Okay, nice, I'm checked in already." That'd be pretty good. Certain types of questions, but at the same point, there should also be a way for us to recognize when someone's checked in. I'm pretty sure there might be an update, so when they check in, we also need to make updates to the tab. Let's talk about that normal case. The normal case is when they have an appointment and then the check-in. That one should be simpler, so they can just check in. By the way, in the check-in, there could be budget cases. Let's say they filled out the form. One case is going to be when they have an appointment. It's pretty good. They might put in some information, for example, just one of them, like the phone number of the account. Make sure to ask for the account because it's always confusing, but sometimes they can do the phone number or email of the account. Both work, and also highlight the account because a lot of people get confused on that. Make sure to highlight that of the account owner, and then you can clarify: "Is this your initial auto-fill?" It should not ask, "Is this your?" but it should auto-fill. If they could have the option to say, "No, it's not me," by the way. If you have an appointment ready, then they fill out the check-in form. Let's say they don't have an appointment; then they would actually need to speak to So then, in this case, let's say it's like an old lady or someone. or someone just walks in, and they don't have an appointment. In this case, they can start to talk to a receptionist. If they don't have an appointment, then they'd have to maybe not get an appointment, or someone doesn't want to fill out the form, which is kind of bad.

In this case, of course, we print out a bunch of these QR codes. If some person doesn't want to fill it out, then in this case, the receptionist could fill it out. The second case is that they'd actually have to check in on their own. This case is going to be kind of bad, unfortunately.

The reason is that if you check in on your own, then, in this case, we have to look at the request and see, "Okay, is this a new request?" If this person just came in, then we need to add them to the current status, right? We need to keep track of the patient's current status, right? Remember, we keep track of the whole customer lifecycle, right?

That should be all the edge cases for this case. Let's go to the next one. What's next? They checked in, failed the information, and then they go to the room. At this point, the doctor can see there's someone there. They could see the current status, right? At this point, the doctor is now in the loop. They should get some signal: "Okay, reception is going to know now. The doctor gets a signal now: it's your turn." Or let's say it might not be the doctor, but let's say, "Well, let me think. Who would actually see?" I believe this is going to be just put as someone sees them. I'm not really sure at this point. It might be a technician, but there's no separate technician. They are all under the same group, of course, APIs should be able to move into the next one. Now we understand the services. They might wait there for a while at this point. After they get the current state, I think there's a med, like the current bill. At this point, there should also be some kind of APIs when they see the medical note. At that point, the patient could also get the printed one. They can also log in to their customer app and see, "This is the current status." What comes next? That's gonna be that one. At that point, they could pay online. I think there would be links there for payments and everything, and it could be saved too. I'm not sure what the best interface is for that, but I think one approach is you just have a You could just have a QR code, and they could put in the same email or whatever, and they'll see, "Hey, you sell this to Ryan." Immediately, it could show all the services we did in a very clear way. Nice UI, and then they would be able to pay. Once they pay, they're pretty much done. Then the move to done phase. That's the whole lifecycle. Of course, we text them and stuff using the same number. so then let's talk about the task force. Let's say there could be a couple ways. Maybe we could use the agents and stuff, but let's say someone makes an issue. Know, of course, it should maintain the same one. This should also be the ages. There should be The veterinarians have their own thing, and you can't delete that one. Only the veterinarians are able to do it. You have admin, which is pretty privileged, but you have VAs and staff. Your staff is the lowest privilege, and you can't delete VAs. The veterinarian is the one above them.
 

Transparency is very important. Transparency is very important. We care a lot about that. Not at the stage where we're going to be at the event stage, but at the point where we are actually going to voice a poll at the different phases I talked about before. That's pretty boring.

One other thing I really want you to focus on is that I think we have a part-time full of all of the API documentation. We really want to follow that. That's the main thing because the main thing is yours.

Also, I'm really bad at analytics, so I want you to recognize that. Somehow, I want you to build in a way where we could do a bunch of analytics, like focus on analytics, because the way we can get paid is the business for the business project. We want the analytics. We also want the fact that if we want to improve their Google reviews, we keep track of that number. Another metric is that I don't think we have access to it, but how many people do they actually hire on the floor? How many receptionists do we want to decrease? If we decrease about one, that's like $60,000 saved per year because they don't need to pay anymore, and $60,000, I mean, that helps us make other things better.

Some other things to look at are ways we actually improve their business, like the time to check if they walk in until completion, so we can decrease the amount of time from the  also, we need to make sure we have notifications and stuff. That's also kind of important. This is some information on what it is and stuff. 


some of the things that are important are:
* This is going to be a multi-tenant system. This is probably one of the most important things.
* Primarily, we wanted to make it an agent type of thing. How are we going to use agents for now? It's going to be this, right? We need to add agents too, because it's going to be everything. Something an agent could do is all pretty much an agent. It's going to get requests. There's not much of an agent, actually, but that's going to be the chat interface, right? We're going to have a chat interface that's going to be for the clients. The client should easily see the status and stuff. We want to kind of overhaul all this stuff, but the main thing is we want to make it very easy to use things like that.
* We care a lot about ease of use. We want to make it so that it might be kind of interesting, right? Right now, I think we want it to be some kind of general type of thing so it's easier to add clients, right? At the same time, we want it to be customizable, preferably. We want to make it very easy to add in things like, for example, if we're going to add in other hospitals. For now, this one's going to be tri-city, multi-tenant, right? Why can I add into that? We want to make it their hospital, right? We barely want our logo in there because we made them on their logo. We are not trying to advertise. We're trying to make it help them. We do not care about ourselves. We care more about helping the business, right? That's the main priority. That's probably what's important to us: to help them. We don't really care about our logo and stuff. We care more about using their stuff.
* One thing that's going to be general for now is that this could be all veterinary. The logos should be animals and stuff, like dogs, whatever, in it, because it could be any veterinary type thing. That could be the main type of thing, right? That would be kind of smart if we just mainly did logos and stuff. That's how the design is going to be: just general pet things. We don't want our logo there. We don't care about our logo. We want their logo. You could have one basic logo.
* I think there are a couple things in our design system. Some of it should be our logo because there's going to be epitch.com, which is our own, but there are going to be other ones which would be very general, like veterinary hospitals that are pretty general. A UI should preferably attach to whatever the name of their hospital is, right? That's the one thing. I'm not entirely sure how we're going to do it, but pretty much we should try to make it so it's going to be multi-tenant. That's the main goal: to figure out, in an easy way, how to be able to add hospitals to this one.
* In our product system, when we make a feature, we're going to make it so it works for other products as well. Our specific company-only thing that would be useful is that we care about our company because we have our own technical ways. We have our own website, epitch, and this one. We also want this one to be very simple and very clear, with not much stuff going on and be super, super easy to use, even for a grandma. We want it to be very accessible too. Anyone should be able to use it. You can give it to your grandma, and they could use it. That's the main goal. That's how you should be using it. Yes, that's kind of how the UI will look. 


So yeah, when you focus on the customer and then kind of work backwards from there. 



Transparency 
Also look at all of this and implement it <IMPORTant>  Okay, we'll go on. Then, sick, and then this one, I'm also going to add what vaccines in a better UI. This is random, and then eat today. If you want to do it like this, you want to have better information. You don't want to make appointments, like, "Oh, sure, what exactly vaccine do they want?" You want to take them down the filter: "My dog is vomiting. Okay, went up, but in the morning or evening, did you give a form bottle? Did he chew up a foreign object, like a toy, or did you change the food? When did you know that kind of stuff?" That way, all the stuff is centered. the arrival should go like from one thing to the other and kind of narrow done etc. 

Actually, maybe when they make the payment, you don't need to ask them anything. Right before the appointment, you want to hit them with the check-in: "Time to check in for your appointment," and then it starts asking all the questions. That's the check-in process.

This is all mock data, so this one you could easily add to people in your team or change its status there. This is going to be the main interface. You could add a bit of analytics, which would be much better than this. This one is the admin page, and the admin can give you a high-level summary of what's going to happen here. It's going to be much less.

For example, you have a dashboard for the employees also. They just need to know what they need to do. The dashboard is pretty good. This thing is for the employees, so it's pretty simple. At this point, most of them would not need to do much. They would only want to see this: "Okay, take the current statuses of the pets, like what stage they're on, before, during, and after. Did they see the doctor? For example, they go in the room, and then the doctor sees them. The tech sees them, and the doctor comes in after. They can see, 'Okay, I'm checked in, but I haven't seen the doctor yet.' That's a good point."

The tech also needs to weigh them and bring them to the back. How about if they're a normal dog? The tech also does that. They go back to the scale, and then the tech tells them, "Okay, do they get checked in, or did the tech see them, or did the doctor see them?" They can see, "Okay, which stage am I in?" After the doctor comes in, it's going to be kind of slightly hidden, like a dropdown menu, so they only see the parts that are relevant to them.

Same thing with the doctor: they don't even see, "Okay, they're here now." That's one: the patient visit. The other is a task manager, like stuff they have to do. It's like a task manager, like a dashboard for the staff, and then a special dashboard for the administrator that has more information. There's also that, so this is staff dash. It needs to beep or something, like you need to pop up here and say, "You have a new message." Will it do that? If Google Chrome allows you to do notifications, if you've ever seen them before, say you have a calendar event now. If you've ever seen them before, I don't really care. Stuff that needs action, we don't want to get too many alerts, but this late, "New message from customer," also text them too. It's easy to text them as well. Text to the staff is very easy to do. I was able to do that shit by a member, so I'm able to do both of them, but it depends on how.

I can figure that out. Not gonna spam them, but for this one, they'll definitely be notifications on the computer. Yes, I still feel like we need to flesh this out step by step. If you wanna get the data, you can get the data, but just don't book anything yet. You can integrate the data, but the software on thing is there yet. That's true. Like I told you, you got to act like you are the receptionist, then you're the technician, then you're the doctor, then you're the person checking them out, and then you got to observe what are all the steps. Okay, I can walk it through that, but I feel like we're not there yet. I agree, so do have access to that room, by the way, or it's not gonna mess up our data, right? No, what does it do exactly? What does that do?

Pretty much what it does is that when we do a request, for example, "Get a patient request," it would just give the data to me, to my software. I'd be like, "Okay, now I understand. This person has some request, or book an appointment." I'm able to just do a write request. Instead, it gives the computer access to do what humans do. It's very hard for the human, for the computer to open that cornerstone and do this task, but now it's way faster because it gives you that kind of direct access. The software kind of gets the data and then writes the data back, so it gets the data from that thing to me, and then also I could write the data back.

The reason why is that I have to get third-party because cornerstone itself does not give you that much access, because they wouldn't want to mess up their thing. We'll go ahead and make sure to put in a key so you don't lock it in there. By the way, did you know William did anything about that guy or this shiver? I know about that guy, because he said you guys have backups of the data and stuff like that. I want to make sure you guys are good, so I want to check with Shabba. It's not William, again. In my Frank, Frank said he paid him hundreds a month or something. We've got over 1,200, and he backs up the data or something. Is it wicked, or do you know if he backed it up recently? I'm guessing yes. She brought me, me, no more. Okay, I thought she, boy, cuz I wanna make sure, like, everything's okay. Yeah, okay, sounds good, cuz yeah, you 

  </IMPORTANT>


We need to iron out everything. 
Honestly I was thinking im not sure if its possible but maybe we cna build on top of cornerstone e.g. put our own dashboard in there for the employees the room etc, but that might not be possible. Also remember this is a important product not a demo.


Ashish 










coffee large cold brew



focus on the UI, so look at this design pattern. I uploaded it from our designer. 
````

## Conversation preparation request - September 13, 2026

````text
Then I also want you to make it so that you don't need to implement stuff right now, but add this one verbatim. After that, I want you to prepare me for the conversation. 
````

## Email request - September 13, 2026

````text
Then I also want you to make an email response, by the way. 
````

## Understanding, reviews, and future direction - September 13, 2026

````text
Also, tell me specifically what he actually wanted in those prompts. What does he want me to do, because he totally sent me that link? Review it, and then, by the way, tell us what we have that we like. I don't have time to plan it right now, and I don't have time to work on this currently. I'm planning to work on this once I get the integration approved and stuff, because then I'm able to build faster and easier. I don't have time to review everything, but this is the overall type of thing we want to do. I just want to get some understanding real quick:&#x20;

- what we currently have
- what we don't have
- what he wanted
- and so on

&#x20;also, one other thing I want you to do is this: after this one, first of all, answer that one, and then I'm going to tell you you can go ahead and do it. Actually, you can figure it out now while we're doing it. Nothing really much, anyway.



What I want you to do is also add in something to maybe the project MD file, or maybe you could figure it out now and just get it out of the way now. We want to download all of the customer reviews because that can be very, very insightful. We want to download it all from Yelp and all from Google Reviews. Try to find out if there's some completely free way to do that.



The only reason we're trying to do this is because we need some kind of understanding. Also, keep in mind we're not trying to replace everything. We're trying to replace everything we have with this one. For now, we have to integrate with Cornerstone because that's where all the data is. Eventually, we would want to move everything away from that. 
````

## Unofficial review collection request - September 13, 2026

````text
Try unofficial methods, like what do other people do? Things like that, copy that. How did they get it? It's a very honest type of thing to do. 
````

## Conversation scope and questions - September 13, 2026

````text
And then, just help out with that stuff. Identify what we have and then what he's talking about. Do you have any open questions, by the way? You could use the skill to ask me, but you only have a maximum of, preferably, 5 questions max. Keep in mind you should be able to answer all the questions here, but if there are literally any open questions, then okay, ask me. 
````

## DataHub status answer - September 13, 2026

In response to whether Tri-City is awaiting approval, approved but not installed, installed but unverified, or confirmed to be syncing real clinic records:

````text
almost about to be synced i think it makes sense for it to be synced when we build so ig uess next time we will have this one ready though
````

## Document labels and conversation preparation - September 13, 2026

````text
&#x20;could you please label the documents you made? Maybe name it v1-v1, just so it's clear I understand which one you did, and then tell me and prepare me for this conversation 
````

## Original ADR source wording - September 13, 2026

Preserved here as the ADRs are condensed.

````text
First of all, the most important thing is that I want you to put in all this information as is. To be honest, a lot of this stuff is pretty good, except the email. For the email, you keep the main decisions and stuff. You don't need to put all the email in, but the agents thing, for sure, and all the stuff that guy wanted, for sure, and all the stuff I told you about, for sure.
````

````text
Could you also consolidate all into one branch, like the main branch, mainline? You could just commit to the main branch.
````

## Customer-first ADR correction - September 13, 2026

````text
Also, get the ADR. For 001 new features, it's not exactly like that. You need to fix these ADRs and make them very token-sensitive and terse. For new features, I meant they should be focusing on the customer. That's what the ADR should be: work backwards.

For the ADRs, write them very token-sensitive and terse. Specifically for the new features, tell it to look at the reviews or some shit, and then bam. I don't know, but just tell it to work backwards from the reviews, and then incorporate it, because work backwards from the customer when you make a new feature. Try to reference it almost exactly like the customer problem, and then try to reference that exactly. Work backwards from the problem, and fix the ADR.

Make sure you have the JSON file somewhere there. I don't really see it. Also, clean up a bunch of useless shit. There's a bunch of useless shit in here, like bleat drafts, shit like that.
````

## Plan feedback and repository setup - October 16, 2026

````text
I kind of did some of the lavish plan. I looked at the customer thing, and I did kind of give you some kind of feedback here.   /Users/sandeep/Downloads/clinic-portal-design-system   


Vet Plan
Make every visit at Tri-City smooth: one Client agent for owners, one task board and Staff agent for the team.
What the clinic asked for
* Reviews: read every Google and Yelp review; fix the biggest complaints first.
* Lab results by email: result arrives, gets matched to the pet, and a summary with likely diagnoses is drafted for the vet to approve (like OpenVet).
* OWNER does not want: Email replies: owner emails "is it ready?" and gets the real answer back
* OWNER does not want: Vet questions: vets ask clinical questions and get answers with sources (like OpenVet).
Customer lifecycle
1. Before: reminder, then a check-in link.
2. Check-in: owner fills the form on their phone.
    1. Room: tech, then doctor. Owner sees the step.
3. Checkout: see services and the bill, pay by link.
4. After: "How's your pet?" Thumbs-down: a person calls back.
Check-in
* Owner's phone or email auto-fills the rest, with a "not me" option.
* Questions narrow down the problem.
* Walk-ins and no-matches go to the front desk.
Task board
* Who's here and what step they're on; details one click away.
* Every request is a task.
* Rooms, alerts, and roles (Staff, Vet, Admin).
Agents
Two agents, each with a few skills.
* Client agent: book (card hold for no-shows), check in, visit status, records, email replies. No medical advice.
* Staff agent: lab-result drafts for the vet, follow-up emails (monthly and 7 days after a visit), price checks, daily summary, invoices. Sends and price changes need a yes.
Using the data
Clinic data    What it powers
Appointments    Check-in auto-fill, reminders, "is it ready?" email replies
Pets and visit history    Lab results matched to the right pet, with past visits as context
Vaccines due    Texts that book the next visit
Last visit dates    Follow-ups, win-back emails, rebooking rate
Invoices    Checkout bill, revenue and no-show numbers
Reviews    Biggest complaints, Google rating over time

  https://github.com/davidondrej/skills   Here's what I want you to do. Here's the design path. Also, one thing I want you to keep in this project agent. MD:
- Do backpass and improve this global agent. MD.
- Make this one very agent-agnostic.
- Try to start something: ADRs.
- For ADRs, I kind of follow what this one is. Could you also keep the ADR stuff?
- Could you please keep that: read all ADRs, all this stuff?
- Could you keep it as local skills? Is that something you could do?
I want you to keep a lot of these skills locally. For example, I want to keep all the ADR stuff here. I want you to keep it and stop overthinking as well. Go ahead and keep all these skills here. There's a bunch of good skills here. Everything by ADR, I want you to keep.
He's running CD, okay? You can open a bunch of different Pi agents or Codex. It doesn't matter. I think opening different Pi agents is pretty good. What we're going to prioritize here is a bunch of Pi agents, all using your crew.
I think I did some lavish planning here, and I think you should also look at all the different things I told you. Here's a high-level thing, and I'd also give you the components here: the UI. For all UI stuff, I want you to use Claude. I think you could also update my first main. For all UI and writing, always direct to Claude.
Try to prioritize using Pi as the harness for the fucking main one, but for UI and writing, always use Claude. Go ahead and do this shit, and come up with the best plan. I think this is the current plan, okay? This seems decent to me. Go ahead, use this thing, and copy and build in a very agent-agnostic way.
Go here and just download all of the relevant skills, especially all ADRs, and kind of copy that, right? I think there's a bunch of niche things here. For example, I have three different profiles, and there's a bunch of conversations here too. I think I put a bunch of stuff. For example, 180, or you can put three different profiles, different settings: admin, staff, and then there's the veterinarian.
Also, make sure never, one thing that's very, very critical: never ever do a write operation. We do not do write operations. Go ahead.
Also, let me just paste this thing to you. One thing I also forgot to mention: we do want to make it easy for the staff to search by client ID. This should be like a task board, all this shit. You should have full access to everything, okay? If there's something fucked up, you have full access to my computer, okay? I'm just going to turn on caffeinate so you have more time.
Also, I think there's a skill under it, like "don't sleep. Do that very, very quickly. Have one run that." This is a skill on this one, on the skills one. First of all, install that one. Actually, first thing, because you basically have very limited time, you need to. I'm just going to turn on caffeinate so you have more time.
Just try to do that, and then parallelize as much as possible. Make sure it's extra high for everything, and you got this, man. You have full access. Never ask me anything. Basically, I'm going to be FK, okay? I already gave you so much shit, so.
By the way, I want you to store the old stuff verbatim. I'm not sure if you have this one. I store all the stuff verbatim. I know it's a lot of stuff, but basically, just tell this stuff verbatim, by the way. You got this, man. You could use my computer for a lot. Keep in mind, just get the shit done. And by the way, imagine: I wish I had more time, but I don't. I did some initial planning. I couldn't do everything, but go ahead and build it out. I think we have some kind of idea here. The design system looks good, and you got this, man.

Eventually, we could do a more lavish plan, I think. Here's what I want: you parallelize as much as possible. Imagine you have infinite. You make sure to use GPT-6 Astro high, extra high, or GPT-6.1 Astro if that came out, or the biggest Astro you have, extra high, for one pie. You got this: just get this thing done, and just build it out.

Right now, TriCity is the main client, but remember we need to build this in a way: this is a class. This is a classic ADR. One ADR is to build this in a way that would be extensible to other clients. Remember, whenever we do something for one customer, it needs to be built in a way that it would actually be able to be used by multiple customers. This is going to be used for multiple clients. Right now, this is the first client. We're going to build this in a way so it's very extensible and easy to scale up heavily, to many ones.

Build, and also don't overengineer. That's also critical, and that's also a core ADR. I'm always checking for that. Make sure you're not overengineering. That's kind of the whole point. I'm checking your plan to make sure you're not overengineering.

Build in a very agent-friendly way. Also, I don't like comments, by the way. I don't know if I mentioned that. Comments are just text and are just bloat, so I don't really like comments.

You got this. Also, I think there was a book called Clean Code. I think you might have that somewhere. Could you make sure it's just somewhere in the repo, like, "Hey, follow this one when needed"? We do want to follow clean code practices. I think there was a book, Clean Code. Read the MD file, so I do want you to see if you have that one too.

Basically, I want to set up this repo perfectly, and then build it out, because we want to build very good code. We don't want to build trash code. Feel free to always clean up a lot, because I think we have a lot of trash code here. Obviously, some of the code here might be almost like, "It's on GitHub, right? The code is not going to go anywhere, right?" You could keep on committing. I'll be able to see on GitHub, "Oh shit, if need be, we could just go back." We're not really scared about losing dead code, to be honest.

You could feel free to clean up a lot. We don't give a shit. Just go back if needed. The code's still going to be there. Go ahead and build in a very, very good way. The current code, I think, is probably pretty bad, so build in a great way. You got this.
````

## DataHub follow-up - October 16, 2026

The user first pasted the DataHub overview, webhook schema and guides. That third-party text is captured in [datahub.md](datahub.md) and not repeated here. The user's own words follow.

````text
 Store this somewhere. I don't know if it's already stored. You got to do this and get this one done. By the way, go ahead, and I think there's some caffeinate bullshit there, so you could go ahead. I'm going to leave you over overnight. And then, at the very, very end, you could go ahead and do a software update, but that's going to be the very, very end. You give me your /goal because I think you can do a lot of shit, but I'm not going to be here, so you need to go ahead and unblock yourself.

You have a computer, you have a CLI, and you could fucking do anything on this computer, bro. Basically, this computer is yours, okay? Parallelize as much as possible, and use Pi extra high. Literally, you could use it for the next 10 hours. I expect you to keep working for 10 hours, to be honest.

If not this, then that's actually a main goal. Set that as a goal: "Hey, I'm going to work for 10 hours." The reason is, why the fuck not? That's actually a goal you do have. The reason is, there are always fucking things to do: clean code, this and that, using NIP, and using the clean code book. The main thing is we want to make clean code, but at the same time, we also want to build shit. Focus all on building.

This is going to be a lot of lines of code, to be honest. Also, by the way, reverse lines of code is probably a good proxy, but at the same time, that's going to be a future thing. The main thing is, I notice a lot of stuff we can do, so make sure it's very, very good. This one builds the way so it's also able to scale up. Help out and build it out.
````
